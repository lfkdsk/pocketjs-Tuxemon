// Included into a scratch copy of PocketJS's desktop host by
// bench-g6-quickjs.sh. It times the real rquickjs Guest + UiSurface while
// replaying the maintained G6 journey; no Bun/JSC execution is measured.
#[cfg(test)]
mod g6_quickjs_bench {
    use super::*;
    use serde::Deserialize;
    use std::time::Instant;

    #[derive(Deserialize)]
    struct Journey {
        masks: Vec<u32>,
    }

    struct Sample {
        frame: usize,
        map: String,
        moving: bool,
        fade: bool,
        js_ms: f64,
        core_ms: f64,
        draw_ms: f64,
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

        fn state(&self) -> (String, bool, bool) {
            serde_json::from_str(&self.string(
                "JSON.stringify([globalThis.__rpgSessionState.mapId,!!globalThis.__rpgSessionState.move.moving,!!globalThis.__rpgSessionState.fade])",
            ))
            .expect("G6 state tuple")
        }

        fn frame(&mut self, frame: usize, mask: u32) -> Sample {
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
            let (map, moving, fade) = self.state();
            Sample {
                frame,
                map,
                moving,
                fade,
                js_ms: (b - a).as_secs_f64() * 1_000.0,
                core_ms: (c - b).as_secs_f64() * 1_000.0,
                draw_ms: (d - c).as_secs_f64() * 1_000.0,
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
        println!(
            "CASE viewport={viewport} kind={label} n={} qjs_p95={:.3}ms qjs_max={:.3}ms total_p95={:.3}ms total_max={:.3}ms worst=f{}:{}",
            samples.len(),
            percentile(&js, 0.95),
            js[js.len() - 1],
            percentile(&total, 0.95),
            total[total.len() - 1],
            worst.frame,
            worst.map,
        );
    }

    fn args(dist: &PathBuf, data: PathBuf, width: u32, height: u32) -> Args {
        Args {
            app: "pocket-tuxemon".into(),
            js: Some(dist.join("pocket-tuxemon.js")),
            pak: Some(dist.join("pocket-tuxemon.pak")),
            file: None,
            data_root: Some(data),
            app_id: Some("dev.lfkdsk.pocket-tuxemon-bench".into()),
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

    #[test]
    #[ignore]
    fn journey() {
        let dist = PathBuf::from(std::env::var("G6_DIST").expect("G6_DIST"));
        let journey_path = PathBuf::from(std::env::var("G6_JOURNEY").expect("G6_JOURNEY"));
        let journey: Journey = serde_json::from_slice(&std::fs::read(journey_path).unwrap()).unwrap();
        let width: u32 = std::env::var("G6_BENCH_W").unwrap().parse().unwrap();
        let height: u32 = std::env::var("G6_BENCH_H").unwrap().parse().unwrap();
        let viewport = format!("{width}x{height}");
        let data = PathBuf::from(format!(
            "/var/tmp/fleet/1833/qjs-data-{}-{width}x{height}",
            std::process::id()
        ));

        let boot_start = Instant::now();
        let runtime = Runtime::boot(args(&dist, data.clone(), width, height)).unwrap();
        let boot_ms = boot_start.elapsed().as_secs_f64() * 1_000.0;
        let mut bench = Bench { rt: runtime };
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
        let mut switches = Vec::new();
        let mut last_map = initial_map;
        let mut switch_tail = 0usize;
        let mut transfers = 0usize;
        for (index, mask) in journey.masks.iter().copied().enumerate().skip(1) {
            let sample = bench.frame(index, mask);
            if sample.map != last_map {
                last_map = sample.map.clone();
                transfers += 1;
                switch_tail = 16;
            }
            if sample.fade || switch_tail > 0 {
                switches.push(sample);
                switch_tail = switch_tail.saturating_sub(1);
            } else if sample.moving || mask & 0x00f0 != 0 {
                walking.push(sample);
            }
        }
        let (end_map, _, _) = bench.state();
        assert_eq!(end_map, "spyder_route1");
        report(&viewport, "walking", &walking);
        report(&viewport, "map-switch", &switches);
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
}
