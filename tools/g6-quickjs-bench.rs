// Included into a scratch copy of PocketJS's desktop host by
// bench-g6-quickjs.sh. It times the real rquickjs Guest + UiSurface while
// replaying the maintained G6 journey; no Bun/JSC execution is measured.
#[cfg(test)]
mod g6_quickjs_bench {
    use super::*;
    use serde::Deserialize;
    use std::collections::HashSet;
    use std::ffi::CString;
    use std::fmt::Write as _;
    use std::path::Path;
    use std::time::Instant;

    const BENCH_APP_ID: &str = "dev.lfkdsk.pocket-tuxemon-bench";

    /// Per-frame timing source.  The 50 ms frame budget asserts on THREAD CPU
    /// time, not wall clock: on a shared host the bench thread is routinely
    /// descheduled for >100 ms, which made the wall-
    /// clock max assertion flaky even though the frame did no work during
    /// the gap.  `CLOCK_THREAD_CPUTIME_ID` advances only while the calling
    /// thread runs, so a descheduled frame shows its real (small) CPU cost
    /// while a frame that genuinely burns >50 ms of CPU still trips the
    /// assertion.  Wall clock is still measured and reported everywhere.
    #[cfg(target_os = "linux")]
    mod thread_cpu {
        #[repr(C)]
        struct Timespec {
            sec: i64,
            nsec: i64,
        }
        unsafe extern "C" {
            fn clock_gettime(clk_id: i32, tp: *mut Timespec) -> i32;
        }
        const CLOCK_THREAD_CPUTIME_ID: i32 = 3;
        pub fn now_ms() -> f64 {
            let mut tp = Timespec { sec: 0, nsec: 0 };
            unsafe {
                clock_gettime(CLOCK_THREAD_CPUTIME_ID, &mut tp);
            }
            tp.sec as f64 * 1_000.0 + tp.nsec as f64 / 1_000_000.0
        }
        pub const AVAILABLE: bool = true;
    }

    #[cfg(not(target_os = "linux"))]
    mod thread_cpu {
        pub fn now_ms() -> f64 {
            // Non-Linux fallback: the host crate has no libc dependency, so
            // fall back to a monotonic wall-clock delta.  The assertion is
            // then as noisy as before on these platforms; the Linux bench
            // (the acceptance host) uses true thread CPU time.
            use std::sync::OnceLock;
            static EPOCH: OnceLock<std::time::Instant> = OnceLock::new();
            let epoch = EPOCH.get_or_init(std::time::Instant::now);
            epoch.elapsed().as_secs_f64() * 1_000.0
        }
        pub const AVAILABLE: bool = false;
    }

    /// Optional CPU-work injection for the red-test: when
    /// G6_INJECT_CPU_FRAME names the current frame, burn G6_INJECT_CPU_MS
    /// milliseconds of real thread CPU time in a busy loop.  This makes the
    /// frame's CPU time exceed the 50 ms budget, proving the assertion
    /// still catches genuinely expensive frames (battle entry/exit, etc.).
    fn maybe_inject_cpu(frame: usize) {
        let Ok(target) = std::env::var("G6_INJECT_CPU_FRAME") else {
            return;
        };
        if target.parse::<usize>().ok() != Some(frame) {
            return;
        }
        let ms: f64 = std::env::var("G6_INJECT_CPU_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(80.0);
        let start = thread_cpu::now_ms();
        while thread_cpu::now_ms() - start < ms {
            std::hint::black_box(0u64.wrapping_add(1));
        }
    }

    /// Complement to maybe_inject_cpu: when G6_INJECT_SLEEP_FRAME names the
    /// current frame, sleep G6_INJECT_SLEEP_MS milliseconds.  This
    /// deschedules the thread (a >100 ms scheduling gap): the
    /// wall-clock duration spikes but the thread CPU time does not, so the
    /// CPU-time budget still passes while the old wall-clock budget would
    /// have failed.  Proves the assertion is immune to scheduling gaps.
    fn maybe_inject_sleep(frame: usize) {
        let Ok(target) = std::env::var("G6_INJECT_SLEEP_FRAME") else {
            return;
        };
        if target.parse::<usize>().ok() != Some(frame) {
            return;
        }
        let ms: u64 = std::env::var("G6_INJECT_SLEEP_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(120);
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }

    #[derive(Deserialize)]
    struct Journey {
        masks: Vec<u32>,
        #[serde(default)]
        battles: Vec<JourneyBattle>,
        #[serde(default)]
        maps: Vec<JourneyMap>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct JourneyBattle {
        start_frame: usize,
        end_frame: usize,
    }

    #[derive(Deserialize)]
    struct JourneyMap {
        frame: usize,
        map: String,
    }

    /// One `ui/gp1-marks.ts` checkpoint: `at` is a
    /// `Date.now()` epoch-ms timestamp recorded by the real production
    /// bundle's own module graph, not a synthetic probe.
    #[derive(Deserialize)]
    struct Gp1Mark {
        name: String,
        at: f64,
    }

    /// GP1: the exact marker sequence main.tsx's module
    /// graph must produce. A missing/renamed/reordered mark is a real bundle
    /// regression (a wrapper stopped importing what it used to, or a new
    /// stage was inserted without updating this list) and must fail the
    /// bench, not print a silently-ignored partial table.
    const EXPECTED_GP1_MARKS: [&str; 5] =
        ["module-start", "engine", "json-literals", "battle-registration", "mount"];

    fn assert_gp1_marks(marks: &[Gp1Mark]) {
        let names: Vec<&str> = marks.iter().map(|mark| mark.name.as_str()).collect();
        assert_eq!(
            names,
            EXPECTED_GP1_MARKS.to_vec(),
            "gp1 marks must be exactly {EXPECTED_GP1_MARKS:?} in that order",
        );
        for pair in marks.windows(2) {
            assert!(
                pair[1].at >= pair[0].at,
                "gp1 marks must be non-decreasing: {} (at {}) came before {} (at {})",
                pair[0].name,
                pair[0].at,
                pair[1].name,
                pair[1].at,
            );
        }
    }

    /// GP1: `Runtime::boot`'s stages up to and including
    /// the bundle eval, timed at their real host-call boundaries instead of
    /// reconstructed from `ui/gp1-marks.ts` deltas. `host_init_ms` covers
    /// pak/source read plus surface/fs mount (no JS runs yet); `compile_ms`
    /// and `eval_ms` are the two halves of what `Guest::eval` normally does
    /// in one call (see `gp1_eval_staged`); `host_finish_ms` is the small
    /// tail after eval (frame-handler check, initial `svc_push`, wiring).
    struct StageTimes {
        host_init_ms: f64,
        compile_ms: f64,
        eval_ms: f64,
        host_finish_ms: f64,
    }

    /// GP1: `pocket_mod::Guest::eval` (vendor/) does one
    /// `JS_Eval` call that both compiles and runs the bundle's top level, so
    /// no existing pocket-mod API can time those halves separately. This
    /// duplicates that one call via the raw quickjs FFI (already used by
    /// `qjs_memory` in this file) instead of modifying pocket-mod: a
    /// `JS_EVAL_FLAG_COMPILE_ONLY` pass produces bytecode without running
    /// anything (real parse + codegen time, not a guess), then
    /// `JS_EvalFunction` runs it (real "everything the bundle's top level
    /// does before `mount()` returns" time — including solid-js's own
    /// module init, which runs before `ui/gp1-marks.ts`'s first mark and so
    /// was invisible to the mark-delta table alone; the old report
    /// attributed that stretch to nothing).
    /// `JS_EvalFunction` always consumes its `fun_obj` argument (quickjs.c
    /// `JS_EvalFunctionInternal`), so the compiled value must not be freed
    /// after a successful compile — only on the compile-failure path, where
    /// `JS_EvalFunction` is never called.
    fn gp1_eval_staged(guest: &Guest, label: &str, source: &str) -> Result<(f64, f64)> {
        use pocket_mod::qjs::qjs as ffi;
        let c_source = CString::new(source)
            .map_err(|_| anyhow!("pocket-mod: bundle source has an embedded NUL byte"))?;
        let c_label = CString::new(label)
            .map_err(|_| anyhow!("pocket-mod: bundle label has an embedded NUL byte"))?;
        let source_len = c_source.as_bytes().len();
        let timings = guest.with(|ctx| -> Result<(f64, f64)> {
            let raw = ctx.as_raw().as_ptr();
            unsafe {
                let compile_start = Instant::now();
                let compiled = ffi::JS_Eval(
                    raw,
                    c_source.as_ptr(),
                    source_len as u64,
                    c_label.as_ptr(),
                    (ffi::JS_EVAL_TYPE_GLOBAL | ffi::JS_EVAL_FLAG_COMPILE_ONLY) as i32,
                );
                let compile_ms = compile_start.elapsed().as_secs_f64() * 1_000.0;
                if compiled.tag == ffi::JS_TAG_EXCEPTION as i64 {
                    ffi::JS_FreeValue(raw, compiled);
                    let error = pocket_mod::qjs::CaughtError::from_error(
                        &ctx,
                        pocket_mod::qjs::Error::Exception,
                    );
                    return Err(anyhow!("pocket-mod: compiling '{label}' failed: {error}"));
                }
                let eval_start = Instant::now();
                let result = ffi::JS_EvalFunction(raw, compiled);
                let eval_ms = eval_start.elapsed().as_secs_f64() * 1_000.0;
                if result.tag == ffi::JS_TAG_EXCEPTION as i64 {
                    ffi::JS_FreeValue(raw, result);
                    let error = pocket_mod::qjs::CaughtError::from_error(
                        &ctx,
                        pocket_mod::qjs::Error::Exception,
                    );
                    return Err(anyhow!("pocket-mod: evaluating '{label}' failed: {error}"));
                }
                ffi::JS_FreeValue(raw, result);
                Ok((compile_ms, eval_ms))
            }
        })?;
        guest.drain_jobs();
        Ok(timings)
    }

    #[test]
    fn staged_eval_reports_javascript_message_and_stack() {
        let guest = Guest::new().unwrap();
        let error = gp1_eval_staged(
            &guest,
            "diagnostic-probe",
            "function explode() { throw new Error('staged-eval sentinel'); } explode();",
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("evaluating 'diagnostic-probe' failed"), "{error}");
        assert!(error.contains("staged-eval sentinel"), "{error}");
        assert!(error.contains("explode"), "{error}");
    }

    /// GP1: a copy of `Runtime::boot`
    /// (vendor/pocket-rpgkit/vendor/pocketjs/hosts/desktop/src/main.rs)
    /// with the single `guest.eval(...)` call replaced by
    /// `gp1_eval_staged` so the compile/eval split above can be timed
    /// inside the exact same realm/surfaces/fs-mount the production 250 ms
    /// budget boots against. `include!` splices this file into main.rs's
    /// own module, so `Runtime`'s private fields and `boot`'s private
    /// helpers (`resolve_asset`, `text_worker`, `HOST_ID`, `HOST_ABI`,
    /// `epoch_ms`, `fs::*`, `AppSupervisor::new`) are directly reachable
    /// here without editing main.rs itself — this is a benchmark-only
    /// duplicate, not a vendor/ change; if `Runtime::boot` changes shape,
    /// this needs re-syncing by hand.
    fn boot_staged(args: Args) -> Result<(Runtime, StageTimes)> {
        if args.native_text {
            return Err(anyhow!(
                "text.layout.native is unavailable; use the portable text offload capability"
            ));
        }
        let host_init_start = Instant::now();
        let pak = std::fs::read(resolve_asset(args.pak.clone(), &args.app, "pak")?)?;
        let source = std::fs::read_to_string(resolve_asset(args.js.clone(), &args.app, "js")?)?;
        let surface = UiSurface::new_with_density(
            (args.viewport.0 as f32, args.viewport.1 as f32),
            args.density,
        );
        surface.set_identity(HOST_ID, HOST_ABI);
        surface.set_tick_rate(60);
        surface.set_svc_allowlist(args.companions.clone());
        surface.feed_pak(&pak);
        let supervisor = AppSupervisor::new(args.system.as_ref(), &surface, args.data_root.clone())?;
        let guest = Guest::new()?;
        surface.mount(&guest)?;
        let offload = text_worker(pak);
        offload.mount(&guest)?;
        let app_id = args.app_id.clone().unwrap_or_else(|| args.app.clone());
        let fs_roots = fs::data_roots(args.data_root.as_deref(), &app_id)?;
        let fs_mount = fs::mount_fs(&guest, &fs_roots)?;
        let host_init_ms = host_init_start.elapsed().as_secs_f64() * 1_000.0;

        let (compile_ms, eval_ms) = gp1_eval_staged(&guest, &args.app, &source)?;

        let host_finish_start = Instant::now();
        if !guest.has_frame() {
            return Err(anyhow!("bundle installed no frame handler"));
        }
        surface.svc_push(
            json!({"t":"hello","w":args.viewport.0,"h":args.viewport.1,"epoch":epoch_ms()})
                .to_string(),
        );
        if let Some(file) = &args.file
            && let Ok(text) = std::fs::read_to_string(file)
        {
            surface.svc_push(json!({"t":"load","text":text}).to_string());
        }
        let wire = args
            .svc_connect
            .clone()
            .map(|addr| net::SvcWire::spawn(addr, args.app.clone()));
        let host_finish_ms = host_finish_start.elapsed().as_secs_f64() * 1_000.0;
        let runtime = Runtime {
            viewport: args.viewport,
            script: args.script.clone(),
            args,
            surface,
            guest,
            supervisor,
            offload,
            _fs: fs_mount,
            ticks: 0,
            buttons: 0,
            script_buttons: 0,
            script_mouse: false,
            click_edge: false,
            mouse_down: false,
            wire,
        };
        Ok((runtime, StageTimes { host_init_ms, compile_ms, eval_ms, host_finish_ms }))
    }

    #[derive(Deserialize)]
    struct MapMeta {
        id: String,
        entry: String,
        width: usize,
        height: usize,
    }

    struct MapSample {
        meta: MapMeta,
        bytes: u64,
        read_parse_ms: f64,
        validate_ms: f64,
        compile_ms: f64,
        commit_ms: f64,
        total_ms: f64,
    }

    #[derive(Clone, Copy, Default)]
    struct StructuralOps {
        create: u64,
        destroy: u64,
        insert: u64,
        remove: u64,
    }

    impl StructuralOps {
        fn total(self) -> u64 {
            self.create + self.destroy + self.insert + self.remove
        }
    }

    #[derive(Clone)]
    struct Sample {
        frame: usize,
        map: String,
        moving: bool,
        fade: bool,
        battle: bool,
        battle_event: Option<String>,
        js_ms: f64,
        core_ms: f64,
        draw_ms: f64,
        /// Thread CPU time for the same three segments.  The 50 ms frame
        /// budget asserts on these, not on the wall-clock *_ms fields, so a
        /// descheduling gap does not trip the budget.
        js_cpu_ms: f64,
        core_cpu_ms: f64,
        draw_cpu_ms: f64,
        draw_sampled: bool,
        structural: StructuralOps,
        // G6_BATTLE_BUCKETS: per-frame battle shape for the p95 explanation.
        player_party: u8,
        enemy_party: u8,
        menu_mode: Option<String>,
    }

    struct Bench {
        rt: Runtime,
        sample_structural: bool,
        hash_every: usize,
        battle_buckets: bool,
    }

    impl Bench {
        fn string(&self, source: &str) -> String {
            self.rt
                .guest
                .with(|ctx| ctx.eval::<String, _>(source).expect("QuickJS string eval"))
        }

        fn boolean(&self, source: &str) -> bool {
            self.rt
                .guest
                .with(|ctx| ctx.eval::<bool, _>(source).expect("QuickJS boolean eval"))
        }

        fn unit(&self, source: &str) {
            self.rt
                .guest
                .with(|ctx| ctx.eval::<(), _>(source).expect("QuickJS unit eval"));
        }

        fn install_structural_counter(&self) {
            self.unit(
                r#"
                globalThis.__g6BattleOps = {createNode:0,destroyNode:0,insertBefore:0,removeChild:0};
                for (const name of ["createNode","destroyNode","insertBefore","removeChild"]) {
                  const original = globalThis.ui[name];
                  globalThis.ui[name] = function(...args) {
                    globalThis.__g6BattleOps[name]++;
                    return original.apply(globalThis.ui, args);
                  };
                }
                "#,
            );
        }

        fn reset_structural_counter(&self) {
            self.unit(
                "for(const name of Object.keys(globalThis.__g6BattleOps))globalThis.__g6BattleOps[name]=0",
            );
        }

        fn structural_ops(&self) -> StructuralOps {
            let values: (u64, u64, u64, u64) = serde_json::from_str(&self.string(
                "JSON.stringify([__g6BattleOps.createNode,__g6BattleOps.destroyNode,__g6BattleOps.insertBefore,__g6BattleOps.removeChild])",
            ))
            .expect("G6 structural-op tuple");
            StructuralOps {
                create: values.0,
                destroy: values.1,
                insert: values.2,
                remove: values.3,
            }
        }

        fn state(&self) -> (String, bool, bool, bool, Option<String>) {
            serde_json::from_str(&self.string(
                r#"(()=>{const s=globalThis.__rpgSessionState;const b=s.scene?.kind==='battle'?s.scene.state:null;return JSON.stringify([s.mapId,!!s.move.moving,!!s.fade,!!b,b?.battle?.events?.[b.eventCursor]?.type??null])})()"#,
            ))
            .expect("G6 state tuple")
        }

        /// Richer per-frame battle shape for the p95 explanation: party sizes
        /// (full party, active+reserve) and the battle menu mode.  Read AFTER
        /// the frame timing points (same as `state`), so the extra eval never
        /// skews js_ms/core_ms/draw_ms.
        fn state_rich(&self) -> (String, bool, bool, bool, Option<String>, u8, u8, Option<String>) {
            serde_json::from_str(&self.string(
                r#"(()=>{const s=globalThis.__rpgSessionState;const b=s.scene?.kind==='battle'?s.scene.state:null;return JSON.stringify([s.mapId,!!s.move.moving,!!s.fade,!!b,b?.battle?.events?.[b.eventCursor]?.type??null,b?b.battle.parties[0].length:0,b?b.battle.parties[1].length:0,b?b.menuMode:null])})()"#,
            ))
            .expect("G6 rich state tuple")
        }

        fn frame(
            &mut self,
            frame: usize,
            mask: u32,
            frozen: Option<(&str, bool)>,
            force_hash: bool,
        ) -> Sample {
            if self.sample_structural {
                self.reset_structural_counter();
            }
            self.rt.buttons = mask;
            self.rt.offload.begin_frame();
            let a = Instant::now();
            let a_cpu = thread_cpu::now_ms();
            // Injection point: inside the measured region so the burned CPU
            // time lands in js_cpu_ms, exactly as a slower QuickJS frame would.
            maybe_inject_cpu(frame);
            // Sleep injection: a descheduling gap inflates the wall-clock
            // segment but not the CPU segment, so the CPU-time budget is
            // immune to it.
            maybe_inject_sleep(frame);
            self.rt.guest.frame(mask).expect("QuickJS frame");
            let b = Instant::now();
            let b_cpu = thread_cpu::now_ms();
            self.rt.surface.tick();
            let c = Instant::now();
            let c_cpu = thread_cpu::now_ms();
            for (id, error) in self
                .rt
                .supervisor
                .sync(&self.rt.surface)
                .into_iter()
                .chain(self.rt.supervisor.tick())
            {
                panic!("AppInstance {id}: {error}");
            }
            let _ = self.rt.surface.svc_drain();
            self.rt.ticks += 1;
            let draw_sampled = force_hash || self.hash_every <= 1 || frame % self.hash_every == 0;
            if draw_sampled {
                let _ = self.rt.hash();
            }
            let d = Instant::now();
            let d_cpu = thread_cpu::now_ms();
            let (map, moving, fade, battle, battle_event, player_party, enemy_party, menu_mode) = if self.battle_buckets {
                let rich = self.state_rich();
                match frozen {
                    Some((fmap, fbattle)) => {
                        (fmap.to_owned(), rich.1, rich.2, fbattle, rich.4, rich.5, rich.6, rich.7)
                    }
                    None => rich,
                }
            } else {
                let (map, moving, fade, battle, battle_event) = match frozen {
                    Some((map, battle)) => (map.to_owned(), false, false, battle, None),
                    None => self.state(),
                };
                (map, moving, fade, battle, battle_event, 0, 0, None)
            };
            let structural = if self.sample_structural {
                self.structural_ops()
            } else {
                StructuralOps::default()
            };
            Sample {
                frame,
                map,
                moving,
                fade,
                battle,
                battle_event,
                js_ms: (b - a).as_secs_f64() * 1_000.0,
                core_ms: (c - b).as_secs_f64() * 1_000.0,
                draw_ms: (d - c).as_secs_f64() * 1_000.0,
                js_cpu_ms: b_cpu - a_cpu,
                core_cpu_ms: c_cpu - b_cpu,
                draw_cpu_ms: d_cpu - c_cpu,
                draw_sampled,
                structural,
                player_party,
                enemy_party,
                menu_mode,
            }
        }
    }

    fn qjs_memory(guest: &Guest) -> (i64, i64, i64) {
        guest.with(|ctx| unsafe {
            let runtime = pocket_mod::qjs::qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
            let mut usage: pocket_mod::qjs::qjs::JSMemoryUsage = std::mem::zeroed();
            pocket_mod::qjs::qjs::JS_ComputeMemoryUsage(runtime, &mut usage);
            (usage.memory_used_size, usage.malloc_size, usage.obj_count)
        })
    }

    fn percentile(sorted: &[f64], fraction: f64) -> f64 {
        sorted[((sorted.len() as f64 - 1.0) * fraction).ceil() as usize]
    }

    fn report(viewport: &str, label: &str, samples: &[Sample]) {
        assert!(!samples.is_empty(), "{label} has no samples");
        let mut js: Vec<f64> = samples.iter().map(|sample| sample.js_ms).collect();
        let mut total: Vec<f64> = samples
            .iter()
            .filter(|sample| sample.draw_sampled)
            .map(|sample| sample.js_ms + sample.core_ms + sample.draw_ms)
            .collect();
        assert!(!total.is_empty(), "{label} has no framebuffer samples");
        js.sort_by(|a, b| a.partial_cmp(b).unwrap());
        total.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let worst = samples
            .iter()
            .filter(|sample| sample.draw_sampled)
            .max_by(|a, b| {
                (a.js_ms + a.core_ms + a.draw_ms)
                    .partial_cmp(&(b.js_ms + b.core_ms + b.draw_ms))
                    .unwrap()
            })
            .unwrap();
        let structural = samples
            .iter()
            .fold(StructuralOps::default(), |mut total, sample| {
                total.create += sample.structural.create;
                total.destroy += sample.structural.destroy;
                total.insert += sample.structural.insert;
                total.remove += sample.structural.remove;
                total
            });
        let structural_max = samples
            .iter()
            .map(|sample| sample.structural.total())
            .max()
            .unwrap_or(0);
        let js_mean = js.iter().sum::<f64>() / js.len() as f64;
        let total_mean = total.iter().sum::<f64>() / total.len() as f64;
        println!(
            "CASE viewport={viewport} kind={label} n={} total_n={} qjs_mean={js_mean:.3}ms qjs_p95={:.3}ms qjs_max={:.3}ms total_mean={total_mean:.3}ms total_p95={:.3}ms total_max={:.3}ms worst=f{}:{} structural={}/{}/{}/{} structural_max={}",
            samples.len(),
            total.len(),
            percentile(&js, 0.95),
            js[js.len() - 1],
            percentile(&total, 0.95),
            total[total.len() - 1],
            worst.frame,
            worst.map,
            structural.create,
            structural.destroy,
            structural.insert,
            structural.remove,
            structural_max,
        );
    }

    fn assert_zero_structural(viewport: &str, label: &str, samples: &[Sample]) {
        let churn: Vec<String> = samples
            .iter()
            .filter(|sample| sample.structural.total() != 0)
            .map(|sample| {
                format!(
                    "f{}:{}/{}/{}/{}",
                    sample.frame,
                    sample.structural.create,
                    sample.structural.destroy,
                    sample.structural.insert,
                    sample.structural.remove,
                )
            })
            .collect();
        assert!(
            churn.is_empty(),
            "{viewport} {label} performed structural UI operations: {}",
            churn.join(","),
        );
        println!(
            "STRUCTURE viewport={viewport} kind={label} frames={} structural=0",
            samples.len()
        );
    }

    /// G6_BATTLE_BUCKETS: break battle-steady frames down by player/enemy
    /// party size, battle event (performance stage), and menu mode, so the
    /// short-vs-long journey p95 delta can be attributed to sample shape
    /// (more monsters, longer animations) rather than a regression.
    fn report_buckets(viewport: &str, label: &str, samples: &[Sample]) {
        use std::collections::BTreeMap;
        let mut groups: BTreeMap<(u8, u8, String, String), Vec<f64>> = BTreeMap::new();
        for sample in samples {
            let key = (
                sample.player_party,
                sample.enemy_party,
                sample.battle_event.clone().unwrap_or_else(|| "-".into()),
                sample.menu_mode.clone().unwrap_or_else(|| "-".into()),
            );
            groups.entry(key).or_default().push(sample.js_ms);
        }
        let mut rows: Vec<_> = groups.into_iter().collect();
        rows.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then_with(|| a.0.cmp(&b.0)));
        println!(
            "BUCKETS viewport={viewport} kind={label} groups={} frames={}",
            rows.len(),
            samples.len()
        );
        for ((pp, ep, event, menu), mut js) in rows {
            js.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let p95 = percentile(&js, 0.95);
            let max = js[js.len() - 1];
            let mean = js.iter().sum::<f64>() / js.len() as f64;
            println!(
                "BUCKET viewport={viewport} kind={label} pp={pp} ep={ep} event={event} menu={menu} n={} qjs_mean={mean:.3}ms qjs_p95={p95:.3}ms qjs_max={max:.3}ms",
                js.len(),
            );
        }
    }

    /// Reads `globalThis.__gp1Marks` right after boot and prints the full
    /// startup breakdown: host init, bundle compile, bundle eval split
    /// into "before module-start" (solid-js + framework top-level init,
    /// invisible to the marks alone — see `gp1_eval_staged`) and the four
    /// `ui/gp1-marks.ts` stages (engine/json-literals/battle-registration/
    /// mount), then the small post-eval host tail. `stages` (host_init_ms,
    /// compile_ms, eval_ms, host_finish_ms) all come from `Instant` at the
    /// real host call boundaries in `boot_staged` — nanosecond resolution.
    /// The four named JS stages still come from `Date.now()` marks (integer
    /// ms — QuickJS has no `performance.now()` and none of this may touch
    /// pocket-mod/vendor to add one), so only their *sum* is cross-checked
    /// against the host-measured `eval_ms - pre_module_start_ms`, not each
    /// individual delta. `assert_gp1_marks` fails the bench outright on a
    /// missing, renamed, or reordered mark — this can no longer silently
    /// print a partial table.
    fn report_startup_stages(viewport: &str, bench: &Bench, boot_ms: f64, stages: &StageTimes) {
        let marks: Vec<Gp1Mark> = serde_json::from_str(&bench.string(
            "JSON.stringify(globalThis.__gp1Marks ?? [])",
        ))
        .expect("gp1 marks JSON");
        assert_gp1_marks(&marks);
        println!(
            "STAGE viewport={viewport} name=host-init at_ms=0.000 delta_ms={:.3}",
            stages.host_init_ms,
        );
        println!(
            "STAGE viewport={viewport} name=compile at_ms={:.3} delta_ms={:.3}",
            stages.host_init_ms,
            stages.compile_ms,
        );
        let eval_start_ms = stages.host_init_ms + stages.compile_ms;
        let t0 = marks[0].at;
        let marked_span_ms = marks[marks.len() - 1].at - t0;
        let pre_module_start_ms = (stages.eval_ms - marked_span_ms).max(0.0);
        println!(
            "STAGE viewport={viewport} name=eval-before-module-start at_ms={:.3} delta_ms={:.3}",
            eval_start_ms,
            pre_module_start_ms,
        );
        let mut prev = t0;
        for mark in &marks {
            println!(
                "STAGE viewport={viewport} name={} at_ms={:.3} delta_ms={:.3}",
                mark.name,
                eval_start_ms + pre_module_start_ms + (mark.at - t0),
                mark.at - prev,
            );
            prev = mark.at;
        }
        let eval_end_ms = eval_start_ms + stages.eval_ms;
        println!(
            "STAGE viewport={viewport} name=host-finish at_ms={:.3} delta_ms={:.3}",
            eval_end_ms,
            stages.host_finish_ms,
        );
        let accounted_ms = eval_end_ms + stages.host_finish_ms;
        println!(
            "STAGE viewport={viewport} name=TOTAL accounted_ms={:.3} boot_ms={:.3} unaccounted_ms={:.3}",
            accounted_ms,
            boot_ms,
            boot_ms - accounted_ms,
        );
    }

    fn assert_frame_budget(label: &str, samples: &[Sample], limit_ms: f64) {
        assert!(!samples.is_empty(), "journey must contain at least one {label} frame");
        // The budget asserts on THREAD CPU time (js_cpu + core_cpu), which is
        // immune to host descheduling: a frame the scheduler parks for 100 ms
        // shows only its real CPU cost.  Wall clock is reported alongside for
        // the record but is not the assertion basis.
        let qjs_core = samples
            .iter()
            .max_by(|a, b| {
                (a.js_cpu_ms + a.core_cpu_ms)
                    .partial_cmp(&(b.js_cpu_ms + b.core_cpu_ms))
                    .unwrap()
            })
            .unwrap();
        let qjs_core_cpu = qjs_core.js_cpu_ms + qjs_core.core_cpu_ms;
        let qjs_core_wall = qjs_core.js_ms + qjs_core.core_ms;
        assert!(
            qjs_core_cpu <= limit_ms,
            "{label} frame f{}:{} exceeded the {limit_ms} ms QJS/core CPU limit: {:.3} ms (wall {:.3} ms)",
            qjs_core.frame,
            qjs_core.map,
            qjs_core_cpu,
            qjs_core_wall,
        );
        let sample = samples
            .iter()
            .filter(|sample| sample.draw_sampled)
            .max_by(|a, b| {
                (a.js_cpu_ms + a.core_cpu_ms + a.draw_cpu_ms)
                    .partial_cmp(&(b.js_cpu_ms + b.core_cpu_ms + b.draw_cpu_ms))
                    .unwrap()
            })
            .unwrap_or_else(|| panic!("{label} has no framebuffer samples"));
        let total_cpu = sample.js_cpu_ms + sample.core_cpu_ms + sample.draw_cpu_ms;
        let total_wall = sample.js_ms + sample.core_ms + sample.draw_ms;
        assert!(
            total_cpu <= limit_ms,
            "{label} frame f{}:{} exceeded the {:.0} ms CPU limit: {:.3} ms (wall {:.3} ms = qjs {:.3} + core {:.3} + draw {:.3})",
            sample.frame,
            sample.map,
            limit_ms,
            total_cpu,
            total_wall,
            sample.js_cpu_ms,
            sample.core_cpu_ms,
            sample.draw_cpu_ms,
        );
        println!(
            "BUDGET kind={label} frames={} qjs_core_max_cpu={qjs_core_cpu:.3}ms wall={qjs_core_wall:.3}ms sampled_total_max_cpu={total_cpu:.3}ms wall={total_wall:.3}ms limit={limit_ms:.0}ms cpu_clock={}",
            samples.len(),
            if thread_cpu::AVAILABLE { "thread-cputime" } else { "wall-fallback" },
        );
    }

    fn args(dist: &PathBuf, app: &str, data: PathBuf, width: u32, height: u32) -> Args {
        Args {
            app: app.into(),
            js: Some(dist.join(format!("{app}.js"))),
            pak: Some(dist.join(format!("{app}.pak"))),
            file: None,
            data_root: Some(data),
            app_id: Some(BENCH_APP_ID.into()),
            title: "G6 QuickJS bench".into(),
            viewport: (width, height),
            fixed: false,
            native_text: false,
            editor: false,
            companions: Vec::new(),
            system: None,
            svc_connect: None,
            density: 1,
            script: Vec::new(),
            quit_after_ticks: None,
            storm: None,
            announce_ready: false,
            trace_frames: false,
        }
    }

    fn seed_maps(source: &Path, data_root: &Path) {
        let app_data = data_root.join(BENCH_APP_ID).join("data");
        let destination = app_data.join("maps");
        let _ = std::fs::remove_dir_all(&destination);
        std::fs::create_dir_all(&destination).expect("create benchmark map data directory");
        let mut copied = 0usize;
        for entry in std::fs::read_dir(source).expect("read G6_MAPS") {
            let entry = entry.expect("read map directory entry");
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            std::fs::copy(&path, destination.join(entry.file_name())).expect("copy map entry");
            copied += 1;
        }
        assert_eq!(copied, 263, "benchmark must stage every imported map");
    }

    /// Recursively stages the sharded battle-runtime tree (`battle/monsters`,
    /// `battle/techniques`, `battle/items`, `battle/statuses`) the same way
    /// the desktop launcher does: readFileSync on desktop resolves against
    /// data.fs, not the pak, so a battle started under this bench needs these
    /// files physically present under the benchmark's own data root.
    fn copy_dir_recursive(source: &Path, destination: &Path) -> usize {
        std::fs::create_dir_all(destination).expect("create benchmark battle data directory");
        let mut copied = 0usize;
        for entry in std::fs::read_dir(source).expect("read G6_BATTLE") {
            let entry = entry.expect("read battle directory entry");
            let path = entry.path();
            let target = destination.join(entry.file_name());
            if path.is_dir() {
                copied += copy_dir_recursive(&path, &target);
            } else if path.extension().and_then(|value| value.to_str()) == Some("json") {
                std::fs::copy(&path, &target).expect("copy battle entry");
                copied += 1;
            }
        }
        copied
    }

    fn seed_battle(source: &Path, data_root: &Path) {
        let app_data = data_root.join(BENCH_APP_ID).join("data");
        let destination = app_data.join("battle");
        let _ = std::fs::remove_dir_all(&destination);
        let copied = copy_dir_recursive(source, &destination);
        assert!(copied > 0, "benchmark must stage the sharded battle database");
    }

    /// Stages the sharded animated-tile tree (`dist/animated/<mapId>.json`)
    /// the same way maps and battle shards are
    /// staged: readFileSync on desktop resolves against data.fs, so any map
    /// with animated tiles needs its shard physically present here.
    fn seed_animated(source: &Path, data_root: &Path) {
        let app_data = data_root.join(BENCH_APP_ID).join("data");
        let destination = app_data.join("animated");
        let _ = std::fs::remove_dir_all(&destination);
        let copied = copy_dir_recursive(source, &destination);
        assert!(copied > 0, "benchmark must stage the sharded animated-tile table");
    }

    /// Stages the sharded per-NPC sprite table (`dist/npc-src/<npcId>.json`),
    /// same reasoning as `seed_animated`.
    fn seed_npc_src(source: &Path, data_root: &Path) {
        let app_data = data_root.join(BENCH_APP_ID).join("data");
        let destination = app_data.join("npc-src");
        let _ = std::fs::remove_dir_all(&destination);
        let copied = copy_dir_recursive(source, &destination);
        assert!(copied > 0, "benchmark must stage the sharded NPC sprite table");
    }

    /// Stages the sharded terrain-stream ground/upper chunk-ref tables
    /// (`dist/terrain-stream/{ground,upper}/<mapId>.json`), same reasoning
    /// as `seed_battle`.
    fn seed_terrain_stream(source: &Path, data_root: &Path) {
        let app_data = data_root.join(BENCH_APP_ID).join("data");
        let destination = app_data.join("terrain-stream");
        let _ = std::fs::remove_dir_all(&destination);
        let copied = copy_dir_recursive(source, &destination);
        assert!(copied > 0, "benchmark must stage the sharded terrain-stream tables");
    }

    #[test]
    #[ignore]
    fn journey() {
        let dist = PathBuf::from(std::env::var("G6_DIST").expect("G6_DIST"));
        let journey_path = PathBuf::from(std::env::var("G6_JOURNEY").expect("G6_JOURNEY"));
        let journey: Journey =
            serde_json::from_slice(&std::fs::read(journey_path).unwrap()).unwrap();
        let width: u32 = std::env::var("G6_BENCH_W").unwrap().parse().unwrap();
        let height: u32 = std::env::var("G6_BENCH_H").unwrap().parse().unwrap();
        let viewport = format!("{width}x{height}");
        let bench_root = PathBuf::from(std::env::var("G6_BENCH_ROOT").expect("G6_BENCH_ROOT"));
        let data = bench_root.join(format!("qjs-data-{}-{width}x{height}", std::process::id()));
        let maps = PathBuf::from(std::env::var("G6_MAPS").expect("G6_MAPS"));
        seed_maps(&maps, &data);
        let battle = PathBuf::from(std::env::var("G6_BATTLE").expect("G6_BATTLE"));
        seed_battle(&battle, &data);
        let animated = PathBuf::from(std::env::var("G6_ANIMATED").expect("G6_ANIMATED"));
        seed_animated(&animated, &data);
        let npc_src = PathBuf::from(std::env::var("G6_NPC_SRC").expect("G6_NPC_SRC"));
        seed_npc_src(&npc_src, &data);
        let terrain_stream = PathBuf::from(std::env::var("G6_TERRAIN_STREAM").expect("G6_TERRAIN_STREAM"));
        seed_terrain_stream(&terrain_stream, &data);

        let boot_start = Instant::now();
        let (runtime, stages) =
            boot_staged(args(&dist, "pocket-tuxemon", data.clone(), width, height)).unwrap();
        let boot_ms = boot_start.elapsed().as_secs_f64() * 1_000.0;
        let sample_structural = std::env::var("G6_FAST_BENCH").as_deref() != Ok("1");
        let battle_buckets = std::env::var("G6_BATTLE_BUCKETS").as_deref() == Ok("1");
        let hash_every = std::env::var("G6_HASH_EVERY")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(1usize)
            .max(1);
        let mut bench = Bench { rt: runtime, sample_structural, hash_every, battle_buckets };
        report_startup_stages(&viewport, &bench, boot_ms, &stages);
        if sample_structural {
            bench.install_structural_counter();
        }
        if sample_structural {
            assert!(journey.maps.is_empty() || journey.battles.is_empty(),
                "short probe mode must classify live state rather than frozen metadata");
        } else {
            assert!(!journey.maps.is_empty(), "fast benchmark requires journey map checkpoints");
            assert!(!journey.battles.is_empty(), "fast benchmark requires journey battle checkpoints");
        }
        let initial_map = if !sample_structural {
            journey.maps[0].map.clone()
        } else {
            bench.state().0
        };
        let frozen_at = |frame: usize| -> Option<(&str, bool)> {
            if !sample_structural {
                let map = journey.maps.iter().rev().find(|mark| mark.frame <= frame).unwrap();
                // Checkpoints describe the post-step scene. `startFrame` is
                // the input that enters battle; `endFrame` is one past the
                // input that exits it, so that exit input is already a world
                // scene sample.
                let battle = journey.battles.iter().any(|mark|
                    mark.start_frame <= frame && frame + 1 < mark.end_frame
                );
                Some((map.map.as_str(), battle))
            } else {
                None
            }
        };
        let mut forced_hashes = HashSet::new();
        if !sample_structural {
            for mark in &journey.maps {
                for frame in mark.frame.saturating_sub(1)..=mark.frame.saturating_add(16) {
                    forced_hashes.insert(frame);
                }
            }
            for mark in &journey.battles {
                forced_hashes.insert(mark.start_frame);
                forced_hashes.insert(mark.start_frame.saturating_add(1));
                forced_hashes.insert(mark.end_frame.saturating_sub(1));
                forced_hashes.insert(mark.end_frame);
            }
        }
        let replay_started = Instant::now();
        let first = bench.frame(0, journey.masks[0], frozen_at(0), forced_hashes.contains(&0));
        let first_paint_ms = boot_start.elapsed().as_secs_f64() * 1_000.0;
        let (used, malloc, objects) = qjs_memory(&bench.rt.guest);
        println!(
            "BOOT viewport={viewport} boot={boot_ms:.3}ms first_qjs={:.3}ms first_total={:.3}ms startup_to_first={first_paint_ms:.3}ms qjs_used={:.2}MiB qjs_malloc={:.2}MiB objects={objects}",
            first.js_ms,
            first.js_ms + first.core_ms + first.draw_ms,
            used as f64 / 1_048_576.0,
            malloc as f64 / 1_048_576.0,
        );
        assert!(
            first_paint_ms <= 250.0,
            "startup viewport={viewport} exceeded the 250 ms startup-to-first-paint budget: {:.3} ms",
            first_paint_ms,
        );

        let mut walking = Vec::new();
        let mut all_frames = Vec::with_capacity(journey.masks.len().saturating_sub(1));
        let mut walking_before_battle = Vec::new();
        let mut walking_after_battle = Vec::new();
        let mut switches = Vec::new();
        let mut battle = Vec::new();
        let mut battle_steady = Vec::new();
        let mut battle_round = Vec::new();
        let mut battle_decision = Vec::new();
        let mut battle_entry = Vec::new();
        let mut battle_exit = Vec::new();
        let mut last_map = initial_map;
        let mut last_battle = first.battle;
        let mut battle_completed = false;
        let mut switch_tail = 0usize;
        let mut transfers = 0usize;
        for (index, mask) in journey.masks.iter().copied().enumerate().skip(1) {
            let sample = bench.frame(
                index,
                mask,
                frozen_at(index),
                forced_hashes.contains(&index),
            );
            all_frames.push(sample.clone());
            if sample.battle {
                battle.push(sample.clone());
                if last_battle {
                    battle_steady.push(sample.clone());
                }
                if sample.battle_event.as_deref() == Some("round") {
                    battle_round.push(sample.clone());
                }
                if sample.battle_event.as_deref() == Some("decision") {
                    battle_decision.push(sample.clone());
                }
            }
            if sample.battle != last_battle {
                if sample.battle {
                    battle_entry.push(sample.clone());
                } else {
                    battle_exit.push(sample.clone());
                    battle_completed = true;
                }
                last_battle = sample.battle;
            }
            if sample.map != last_map {
                last_map = sample.map.clone();
                transfers += 1;
                switch_tail = 16;
            }
            if sample.fade || switch_tail > 0 {
                switches.push(sample);
                switch_tail = switch_tail.saturating_sub(1);
            } else if sample.moving || mask & 0x00f0 != 0 {
                if battle_completed {
                    walking_after_battle.push(sample.clone());
                } else {
                    walking_before_battle.push(sample.clone());
                }
                walking.push(sample);
            }
        }
        let replay_wall_ms = replay_started.elapsed().as_secs_f64() * 1_000.0;
        let (end_map, _, _, _, _) = bench.state();
        let expected_map = std::env::var("G6_EXPECTED_MAP").unwrap_or_else(|_| "spyder_route1".into());
        assert_eq!(end_map, expected_map);
        let state_text = bench.string("JSON.stringify(globalThis.__rpgSessionState)");
        let state: serde_json::Value =
            serde_json::from_str(&state_text).expect("terminal state JSON");
        let state_out = PathBuf::from(std::env::var("G6_STATE_OUT").expect("G6_STATE_OUT"));
        std::fs::write(&state_out, serde_json::to_vec(&state).unwrap())
            .expect("write canonical state");
        report(&viewport, "walking", &walking);
        report(&viewport, "walking-before-battle", &walking_before_battle);
        report(&viewport, "walking-after-battle", &walking_after_battle);
        report(&viewport, "map-switch", &switches);
        assert_frame_budget("map-switch", &switches, 50.0);
        report(&viewport, "battle", &battle);
        report(&viewport, "battle-steady", &battle_steady);
        if sample_structural {
            assert_zero_structural(&viewport, "battle-steady", &battle_steady);
        } else {
            println!(
                "STRUCTURE viewport={viewport} kind=battle-steady frames={} structural=not-sampled",
                battle_steady.len(),
            );
        }
        if sample_structural {
            report(&viewport, "battle-round", &battle_round);
            report(&viewport, "battle-decision", &battle_decision);
        } else {
            println!("CASE viewport={viewport} kind=battle-round source=standalone-reducer-benchmark");
        }
        report(&viewport, "battle-entry", &battle_entry);
        report(&viewport, "battle-exit", &battle_exit);
        assert_frame_budget("battle-entry", &battle_entry, 50.0);
        assert_frame_budget("battle-exit", &battle_exit, 50.0);
        if battle_buckets {
            report_buckets(&viewport, "battle-steady", &battle_steady);
        }
        report(&viewport, "all", &all_frames);
        assert_frame_budget("all", &all_frames, 50.0);
        let measured_qjs_core_ms = first.js_ms + first.core_ms + all_frames
            .iter()
            .map(|sample| sample.js_ms + sample.core_ms)
            .sum::<f64>();
        let sampled_draw_ms = std::iter::once(&first)
            .chain(all_frames.iter())
            .filter(|sample| sample.draw_sampled)
            .map(|sample| sample.draw_ms)
            .sum::<f64>();
        let sampled_draw_frames = std::iter::once(&first)
            .chain(all_frames.iter())
            .filter(|sample| sample.draw_sampled)
            .count();
        println!(
            "REPLAY viewport={viewport} frames={} qjs_core_ms={measured_qjs_core_ms:.3} sampled_draw_ms={sampled_draw_ms:.3} sampled_draw_frames={sampled_draw_frames} hash_every={hash_every} wall_ms={replay_wall_ms:.3}",
            journey.masks.len(),
        );
        let (used, malloc, objects) = qjs_memory(&bench.rt.guest);
        println!(
            "END viewport={viewport} frames={} transfers={} map={end_map} qjs_used={:.2}MiB qjs_malloc={:.2}MiB objects={objects}",
            journey.masks.len(),
            transfers,
            used as f64 / 1_048_576.0,
            malloc as f64 / 1_048_576.0,
        );
        let _ = std::fs::remove_dir_all(data);
    }

    fn timed_bool(bench: &Bench, source: &str) -> (bool, f64) {
        let started = Instant::now();
        let result = bench.boolean(source);
        (result, started.elapsed().as_secs_f64() * 1_000.0)
    }

    fn timed_unit(bench: &Bench, source: &str) -> f64 {
        let started = Instant::now();
        bench.unit(source);
        started.elapsed().as_secs_f64() * 1_000.0
    }

    #[test]
    #[ignore]
    fn map_first_visits() {
        let dist = PathBuf::from(std::env::var("G6_MAP_BENCH_DIST").expect("G6_MAP_BENCH_DIST"));
        let maps = PathBuf::from(std::env::var("G6_MAPS").expect("G6_MAPS"));
        let bench_root = PathBuf::from(std::env::var("G6_BENCH_ROOT").expect("G6_BENCH_ROOT"));
        let report = PathBuf::from(std::env::var("G6_MAP_REPORT").expect("G6_MAP_REPORT"));
        let data = bench_root.join(format!("qjs-map-data-{}", std::process::id()));
        seed_maps(&maps, &data);
        let runtime =
            Runtime::boot(args(&dist, "map-benchmark-entry", data.clone(), 480, 272)).unwrap();
        let bench = Bench { rt: runtime, sample_structural: false, hash_every: 1, battle_buckets: false };
        let metadata: Vec<MapMeta> = serde_json::from_str(
            &bench.string("JSON.stringify(globalThis.__rpgMapBenchmark.maps)"),
        )
        .expect("map benchmark metadata");
        assert_eq!(metadata.len(), 263, "benchmark must see every imported map");

        let mut samples = Vec::with_capacity(metadata.len());
        for meta in metadata {
            let id = serde_json::to_string(&meta.id).unwrap();
            bench.unit(&format!("globalThis.__rpgMapBenchmark.begin({id})"));
            let total_started = Instant::now();
            let (parsed, read_parse_ms) =
                timed_bool(&bench, &format!("globalThis.__rpgMapBenchmark.step({id})"));
            let (validated, validate_ms) =
                timed_bool(&bench, &format!("globalThis.__rpgMapBenchmark.step({id})"));
            let (compiled, compile_ms) =
                timed_bool(&bench, &format!("globalThis.__rpgMapBenchmark.step({id})"));
            assert!(!parsed, "{} parse step must remain staged", meta.id);
            assert!(!validated, "{} validation step must remain staged", meta.id);
            assert!(
                compiled,
                "{} compile step must complete preparation",
                meta.id
            );
            let commit_ms = timed_unit(
                &bench,
                &format!("globalThis.__rpgMapBenchmark.commit({id})"),
            );
            let total_ms = total_started.elapsed().as_secs_f64() * 1_000.0;
            let bytes = std::fs::metadata(maps.join(&meta.entry["maps/".len()..]))
                .expect("map entry metadata")
                .len();
            samples.push(MapSample {
                meta,
                bytes,
                read_parse_ms,
                validate_ms,
                compile_ms,
                commit_ms,
                total_ms,
            });
        }

        let mut table = String::from(
            "map\twidth\theight\tbytes\tread_parse_ms\tvalidate_ms\tcompile_ms\tcommit_ms\tworst_stage_ms\ttotal_ms\tlimit\n",
        );
        let mut stages = Vec::with_capacity(samples.len());
        let mut worst_non_exempt: Option<(&MapSample, f64)> = None;
        let mut worst_all: Option<(&MapSample, f64)> = None;
        for sample in &samples {
            let worst = sample
                .read_parse_ms
                .max(sample.validate_ms)
                .max(sample.compile_ms)
                .max(sample.commit_ms);
            stages.push(worst);
            if worst_all.map_or(true, |(_, value)| worst > value) {
                worst_all = Some((sample, worst));
            }
            if sample.meta.id != "test_npcs"
                && worst_non_exempt.map_or(true, |(_, value)| worst > value)
            {
                worst_non_exempt = Some((sample, worst));
            }
            let limit = if sample.meta.id == "test_npcs" {
                "exempt"
            } else if worst <= 50.0 {
                "pass"
            } else {
                "FAIL"
            };
            writeln!(
                table,
                "{}\t{}\t{}\t{}\t{:.3}\t{:.3}\t{:.3}\t{:.3}\t{:.3}\t{:.3}\t{}",
                sample.meta.id,
                sample.meta.width,
                sample.meta.height,
                sample.bytes,
                sample.read_parse_ms,
                sample.validate_ms,
                sample.compile_ms,
                sample.commit_ms,
                worst,
                sample.total_ms,
                limit,
            )
            .unwrap();
        }
        if let Some(parent) = report.parent() {
            std::fs::create_dir_all(parent).expect("create map report directory");
        }
        std::fs::write(&report, table).expect("write map first-visit report");

        stages.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let (worst_map, worst_ms) = worst_all.unwrap();
        let (worst_non_exempt_map, worst_non_exempt_ms) = worst_non_exempt.unwrap();
        println!(
            "MAPS n={} stage_p95={:.3}ms stage_max={:.3}ms worst={} non_exempt_max={:.3}ms non_exempt_worst={} report={}",
            samples.len(),
            percentile(&stages, 0.95),
            worst_ms,
            worst_map.meta.id,
            worst_non_exempt_ms,
            worst_non_exempt_map.meta.id,
            report.display(),
        );
        assert!(
            worst_non_exempt_ms <= 50.0,
            "map {} exceeded the 50 ms staged first-visit limit: {:.3} ms",
            worst_non_exempt_map.meta.id,
            worst_non_exempt_ms,
        );
        let _ = std::fs::remove_dir_all(data);
    }
}
