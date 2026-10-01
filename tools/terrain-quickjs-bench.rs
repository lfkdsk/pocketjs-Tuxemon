// Included into a scratch copy of PocketJS's desktop host by
// bench-terrain-quickjs.sh. This deliberately times the real QuickJS Guest
// and UiSurface instead of Bun/JSC.
#[cfg(test)]
mod terrain_quickjs_bench {
    use super::*;
    use std::time::Instant;

    struct Sample {
        label: String,
        js: f64,
        core: f64,
        gc: bool,
    }

    struct Bench {
        rt: Runtime,
    }

    fn env_u32(name: &str, default: u32) -> u32 {
        std::env::var(name)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default)
    }

    fn qjs_memory(guest: &Guest) -> (i64, i64, i64) {
        guest.with(|ctx| unsafe {
            let runtime = pocket_mod::qjs::qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
            let mut usage: pocket_mod::qjs::qjs::JSMemoryUsage = std::mem::zeroed();
            pocket_mod::qjs::qjs::JS_ComputeMemoryUsage(runtime, &mut usage);
            (usage.memory_used_size, usage.malloc_size, usage.obj_count)
        })
    }

    fn gc_threshold(guest: &Guest) -> usize {
        guest.with(|ctx| unsafe {
            let runtime = pocket_mod::qjs::qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
            pocket_mod::qjs::qjs::JS_GetGCThreshold(runtime) as usize
        })
    }

    impl Bench {
        fn eval(&self, source: &str) {
            self.rt
                .guest
                .with(|ctx| ctx.eval::<(), _>(source).expect("QuickJS eval"));
        }

        fn string(&self, source: &str) -> String {
            self.rt
                .guest
                .with(|ctx| ctx.eval::<String, _>(source).expect("QuickJS string eval"))
        }

        fn set_map(&self, map: &str) {
            let map = serde_json::to_string(map).unwrap();
            self.eval(&format!(
                "globalThis.__terrainPreview={{map:{map},marker:false}}"
            ));
        }

        fn frame(&mut self, label: &str) -> Sample {
            let before = gc_threshold(&self.rt.guest);
            self.rt._audio_host.begin_tick();
            self.rt.audio.begin_tick();
            self.rt.offload.begin_frame();
            let a = Instant::now();
            self.rt.guest.frame(0).unwrap();
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
                log::error!("AppInstance {id}: {error}");
            }
            let _ = self.rt.surface.svc_drain();
            self.rt.ticks += 1;
            Sample {
                label: label.to_string(),
                js: (b - a).as_secs_f64() * 1000.0,
                core: (c - b).as_secs_f64() * 1000.0,
                gc: gc_threshold(&self.rt.guest) != before,
            }
        }
    }

    fn percentile(sorted: &[f64], fraction: f64) -> f64 {
        sorted[((sorted.len() as f64 - 1.0) * fraction).ceil() as usize]
    }

    fn report(label: &str, samples: &[Sample]) {
        let mut js: Vec<f64> = samples.iter().map(|sample| sample.js).collect();
        let mut core: Vec<f64> = samples.iter().map(|sample| sample.core).collect();
        js.sort_by(|a, b| a.partial_cmp(b).unwrap());
        core.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let worst_js = samples
            .iter()
            .max_by(|a, b| a.js.partial_cmp(&b.js).unwrap())
            .unwrap();
        let worst_total = samples
            .iter()
            .max_by(|a, b| (a.js + a.core).partial_cmp(&(b.js + b.core)).unwrap())
            .unwrap();
        println!(
            "CASE {label}: n={} js mean={:.3}ms p95={:.3}ms max={:.3}ms worst={} | core mean={:.3}ms p95={:.3}ms max={:.3}ms | total max={:.3}ms worst={} | gcFrames={} over16.7={}",
            samples.len(),
            js.iter().sum::<f64>() / samples.len() as f64,
            percentile(&js, 0.95),
            js[js.len() - 1],
            worst_js.label,
            core.iter().sum::<f64>() / samples.len() as f64,
            percentile(&core, 0.95),
            core[core.len() - 1],
            worst_total.js + worst_total.core,
            worst_total.label,
            samples.iter().filter(|sample| sample.gc).count(),
            samples
                .iter()
                .filter(|sample| sample.js + sample.core > 16.667)
                .count(),
        );
    }

    #[test]
    #[ignore]
    fn all_terrain_maps() {
        let dist = PathBuf::from(std::env::var("G5_DIST").expect("G5_DIST"));
        let width = env_u32("G5_BENCH_W", 480);
        let height = env_u32("G5_BENCH_H", 272);
        let repetitions = env_u32("G5_BENCH_REPS", 3) as usize;
        let stable_frames = env_u32("G5_BENCH_STABLE", 600) as usize;
        let external_data = std::env::var_os("G5_DATA_ROOT").map(PathBuf::from);
        let data = external_data.clone().unwrap_or_else(|| {
            std::env::temp_dir().join(format!(
                "tuxemon-terrain-quickjs-data-{}",
                std::process::id()
            ))
        });
        let args = Args {
            app: "terrain-preview".into(),
            js: Some(dist.join("terrain-preview.js")),
            pak: Some(dist.join("terrain-preview.pak")),
            file: None,
            data_root: Some(data.clone()),
            app_id: Some("dev.lfkdsk.pocket-tuxemon-terrain-bench".into()),
            title: "terrain bench".into(),
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
        };

        let boot_start = Instant::now();
        let runtime = Runtime::boot(args).unwrap();
        let boot_ms = boot_start.elapsed().as_secs_f64() * 1000.0;
        let mut bench = Bench { rt: runtime };
        let maps_json = bench.string("JSON.stringify(globalThis.__terrainPreviewMaps)");
        let maps: Vec<String> = serde_json::from_str(&maps_json).unwrap();
        assert_eq!(maps.len(), 263);

        let first = bench.frame("cold-first-frame");
        let (used, malloc, objects) = qjs_memory(&bench.rt.guest);
        println!(
            "BOOT viewport={width}x{height} maps={} boot={boot_ms:.1}ms first js={:.3}ms core={:.3}ms qjsUsed={:.2}MiB malloc={:.2}MiB objects={objects}",
            maps.len(),
            first.js,
            first.core,
            used as f64 / 1_048_576.0,
            malloc as f64 / 1_048_576.0,
        );
        for _ in 0..8 {
            bench.frame("settle");
        }

        let mut stable = Vec::with_capacity(stable_frames);
        for _ in 0..stable_frames {
            stable.push(bench.frame(&maps[0]));
        }
        report("stable", &stable);

        let mut switches = Vec::with_capacity(maps.len() * repetitions);
        for repetition in 0..repetitions {
            for offset in 0..maps.len() {
                // Rotate every sweep so the first sample is also a real map
                // change, including after the previous sweep's last map.
                let map = &maps[(offset + repetition + 1) % maps.len()];
                bench.set_map(map);
                switches.push(bench.frame(map));
                let shown = bench.string(
                    "String(globalThis.__terrainPreviewState && globalThis.__terrainPreviewState.map)",
                );
                assert_eq!(&shown, map);
            }
        }
        report("switch-all-maps", &switches);

        let (used, malloc, objects) = qjs_memory(&bench.rt.guest);
        println!(
            "END viewport={width}x{height} switches={} qjsUsed={:.2}MiB malloc={:.2}MiB objects={objects}",
            switches.len(),
            used as f64 / 1_048_576.0,
            malloc as f64 / 1_048_576.0,
        );
        if external_data.is_none() {
            let _ = std::fs::remove_dir_all(data);
        }
    }
}
