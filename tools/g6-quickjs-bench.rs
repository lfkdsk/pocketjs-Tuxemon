// Included into a scratch copy of PocketJS's desktop host by
// bench-g6-quickjs.sh. It times the real rquickjs Guest + UiSurface while
// replaying the maintained G6 journey; no Bun/JSC execution is measured.
#[cfg(test)]
mod g6_quickjs_bench {
    use super::*;
    use serde::Deserialize;
    use std::fmt::Write as _;
    use std::path::Path;
    use std::time::Instant;

    const BENCH_APP_ID: &str = "dev.lfkdsk.pocket-tuxemon-bench";

    #[derive(Deserialize)]
    struct Journey {
        masks: Vec<u32>,
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

        let boot_start = Instant::now();
        let runtime =
            Runtime::boot(args(&dist, "pocket-tuxemon", data.clone(), width, height)).unwrap();
        let boot_ms = boot_start.elapsed().as_secs_f64() * 1_000.0;
        let mut bench = Bench { rt: runtime };
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
