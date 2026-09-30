// Included into a scratch copy of PocketJS's desktop host by
// bench-g6-quickjs.sh. It times the real rquickjs Guest + UiSurface while
// replaying the maintained G6 journey; no Bun/JSC execution is measured.
#[cfg(test)]
mod g6_quickjs_bench {
    use super::*;
    use serde::Deserialize;
    use std::ffi::CString;
    use std::fmt::Write as _;
    use std::path::Path;
    use std::time::Instant;

    const BENCH_APP_ID: &str = "dev.lfkdsk.pocket-tuxemon-bench";

    #[derive(Deserialize)]
    struct Journey {
        masks: Vec<u32>,
    }

    /// One `ui/gp1-marks.ts` checkpoint (findings/GP1.md "Fix 1"): `at` is a
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
                    return Err(anyhow!("pocket-mod: compiling '{label}' failed"));
                }
                let eval_start = Instant::now();
                let result = ffi::JS_EvalFunction(raw, compiled);
                let eval_ms = eval_start.elapsed().as_secs_f64() * 1_000.0;
                if result.tag == ffi::JS_TAG_EXCEPTION as i64 {
                    ffi::JS_FreeValue(raw, result);
                    return Err(anyhow!("pocket-mod: evaluating '{label}' failed"));
                }
                ffi::JS_FreeValue(raw, result);
                Ok((compile_ms, eval_ms))
            }
        })?;
        guest.drain_jobs();
        Ok(timings)
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
        js_ms: f64,
        core_ms: f64,
        draw_ms: f64,
        structural: StructuralOps,
    }

    struct Bench {
        rt: Runtime,
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

        fn state(&self) -> (String, bool, bool, bool) {
            serde_json::from_str(&self.string(
                "JSON.stringify([globalThis.__rpgSessionState.mapId,!!globalThis.__rpgSessionState.move.moving,!!globalThis.__rpgSessionState.fade,globalThis.__rpgSessionState.scene?.kind==='battle'])",
            ))
            .expect("G6 state tuple")
        }

        fn frame(&mut self, frame: usize, mask: u32) -> Sample {
            self.reset_structural_counter();
            self.rt.buttons = mask;
            self.rt.offload.begin_frame();
            let a = Instant::now();
            self.rt.guest.frame(mask).expect("QuickJS frame");
            let b = Instant::now();
            self.rt.surface.tick();
            let c = Instant::now();
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
            let _ = self.rt.hash();
            let d = Instant::now();
            let (map, moving, fade, battle) = self.state();
            let structural = self.structural_ops();
            Sample {
                frame,
                map,
                moving,
                fade,
                battle,
                js_ms: (b - a).as_secs_f64() * 1_000.0,
                core_ms: (c - b).as_secs_f64() * 1_000.0,
                draw_ms: (d - c).as_secs_f64() * 1_000.0,
                structural,
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
            .map(|sample| sample.js_ms + sample.core_ms + sample.draw_ms)
            .collect();
        js.sort_by(|a, b| a.partial_cmp(b).unwrap());
        total.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let worst = samples
            .iter()
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
        println!(
            "CASE viewport={viewport} kind={label} n={} qjs_p95={:.3}ms qjs_max={:.3}ms total_p95={:.3}ms total_max={:.3}ms worst=f{}:{} structural={}/{}/{}/{} structural_max={}",
            samples.len(),
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

    /// Reads `globalThis.__gp1Marks` right after boot and prints the full
    /// startup breakdown (findings/GP1.md "Fix 1"/"Fix 2",
    /// GP1: host init, bundle compile, bundle eval split
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

    fn assert_single_frame_budget(label: &str, samples: &[Sample], limit_ms: f64) {
        assert_eq!(
            samples.len(),
            1,
            "journey must contain exactly one {label} frame"
        );
        let sample = &samples[0];
        let total_ms = sample.js_ms + sample.core_ms + sample.draw_ms;
        assert!(
            total_ms <= limit_ms,
            "{label} frame f{}:{} exceeded the {:.0} ms limit: {:.3} ms (qjs {:.3} + core {:.3} + draw {:.3})",
            sample.frame,
            sample.map,
            limit_ms,
            total_ms,
            sample.js_ms,
            sample.core_ms,
            sample.draw_ms,
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

    /// Stages the sharded animated-tile tree (`dist/animated/<mapId>.json`,
    /// findings/GP1.md "Fix 1") the same way maps and battle shards are
    /// staged: readFileSync on desktop resolves against data.fs, so any map
    /// with animated tiles needs its shard physically present here.
    fn seed_animated(source: &Path, data_root: &Path) {
        let app_data = data_root.join(BENCH_APP_ID).join("data");
        let destination = app_data.join("animated");
        let _ = std::fs::remove_dir_all(&destination);
        let copied = copy_dir_recursive(source, &destination);
        assert!(copied > 0, "benchmark must stage the sharded animated-tile table");
    }

    /// Stages the sharded per-NPC sprite table (`dist/npc-src/<npcId>.json`,
    /// findings/GP1.md "Fix 1"), same reasoning as `seed_animated`.
    fn seed_npc_src(source: &Path, data_root: &Path) {
        let app_data = data_root.join(BENCH_APP_ID).join("data");
        let destination = app_data.join("npc-src");
        let _ = std::fs::remove_dir_all(&destination);
        let copied = copy_dir_recursive(source, &destination);
        assert!(copied > 0, "benchmark must stage the sharded NPC sprite table");
    }

    /// Stages the sharded terrain-stream ground/upper chunk-ref tables
    /// (`dist/terrain-stream/{ground,upper}/<mapId>.json`, findings/GP1.md
    /// "Fix 1"), same reasoning as `seed_battle`.
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
        let mut bench = Bench { rt: runtime };
        report_startup_stages(&viewport, &bench, boot_ms, &stages);
        bench.install_structural_counter();
        let initial_map = bench.state().0;
        let first = bench.frame(0, journey.masks[0]);
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
        let mut battle_entry = Vec::new();
        let mut battle_exit = Vec::new();
        let mut last_map = initial_map;
        let mut last_battle = first.battle;
        let mut battle_completed = false;
        let mut switch_tail = 0usize;
        let mut transfers = 0usize;
        for (index, mask) in journey.masks.iter().copied().enumerate().skip(1) {
            let sample = bench.frame(index, mask);
            all_frames.push(sample.clone());
            if sample.battle {
                battle.push(sample.clone());
                if last_battle {
                    battle_steady.push(sample.clone());
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
        let (end_map, _, _, _) = bench.state();
        assert_eq!(end_map, "spyder_route1");
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
        report(&viewport, "battle", &battle);
        report(&viewport, "battle-steady", &battle_steady);
        assert_zero_structural(&viewport, "battle-steady", &battle_steady);
        report(&viewport, "battle-entry", &battle_entry);
        report(&viewport, "battle-exit", &battle_exit);
        assert_single_frame_budget("battle-entry", &battle_entry, 50.0);
        assert_single_frame_budget("battle-exit", &battle_exit, 50.0);
        report(&viewport, "all", &all_frames);
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
        let bench = Bench { rt: runtime };
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
