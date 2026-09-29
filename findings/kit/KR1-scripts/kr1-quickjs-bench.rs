// Included into a scratch copy of PocketJS's desktop host. This measures the
// real rquickjs Guest + UiSurface; Bun/JSC is used only to prepare bundles.
#[cfg(test)]
mod kr1_quickjs_bench {
    use super::*;
    use serde::Deserialize;
    use std::time::Instant;

    #[derive(Deserialize)]
    struct Journey {
        masks: Vec<u32>,
    }

    struct Sample {
        frame: usize,
        from: String,
        to: String,
        js_ms: f64,
        total_ms: f64,
        reads: i32,
    }

    fn qjs_memory(guest: &Guest) -> (i64, i64, i64) {
        guest.with(|ctx| unsafe {
            let runtime = pocket_mod::qjs::qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
            let mut usage: pocket_mod::qjs::qjs::JSMemoryUsage = std::mem::zeroed();
            pocket_mod::qjs::qjs::JS_ComputeMemoryUsage(runtime, &mut usage);
            (usage.memory_used_size, usage.malloc_size, usage.obj_count)
        })
    }

    fn collect_qjs(guest: &Guest) -> Vec<f64> {
        (0..3).map(|_| {
            let started = Instant::now();
            guest.with(|ctx| unsafe {
                let runtime = pocket_mod::qjs::qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
                pocket_mod::qjs::qjs::JS_RunGC(runtime);
            });
            started.elapsed().as_secs_f64() * 1_000.0
        }).collect()
    }

    fn rss_kib() -> u64 {
        std::fs::read_to_string("/proc/self/status")
            .ok()
            .and_then(|status| status.lines().find(|line| line.starts_with("VmRSS:"))
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|value| value.parse().ok()))
            .unwrap_or(0)
    }

    fn fnv1a64(bytes: &[u8]) -> u64 {
        let mut hash = 0xcbf29ce484222325u64;
        for byte in bytes {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash
    }

    struct Bench {
        rt: Runtime,
    }

    impl Bench {
        fn string(&self, source: &str) -> String {
            self.rt.guest.with(|ctx| ctx.eval::<String, _>(source).expect("QuickJS eval"))
        }

        fn map(&self) -> String {
            self.string("globalThis.__rpgSessionState.mapId")
        }

        fn reads(&self) -> i32 {
            self.rt.guest.with(|ctx| ctx.eval::<i32, _>("globalThis.__kr1MapReads || 0").unwrap())
        }

        fn frame(&mut self, mask: u32) -> (f64, f64) {
            self.rt.buttons = mask;
            self.rt.offload.begin_frame();
            let a = Instant::now();
            self.rt.guest.frame(mask).expect("QuickJS frame");
            let b = Instant::now();
            self.rt.surface.tick();
            for (id, error) in self.rt.supervisor.sync(&self.rt.surface)
                .into_iter().chain(self.rt.supervisor.tick()) {
                panic!("AppInstance {id}: {error}");
            }
            let _ = self.rt.surface.svc_drain();
            self.rt.ticks += 1;
            let _ = self.rt.hash();
            let c = Instant::now();
            ((b - a).as_secs_f64() * 1_000.0, (c - a).as_secs_f64() * 1_000.0)
        }
    }

    fn args(dist: &PathBuf, data: PathBuf) -> Args {
        Args {
            app: "main".into(),
            js: Some(dist.join("main.js")),
            pak: Some(dist.join("main.pak")),
            file: None,
            data_root: Some(data),
            app_id: Some("dev.lfkdsk.kr1-bench".into()),
            title: "KR1 map repository benchmark".into(),
            viewport: (480, 272),
            fixed: true,
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
    fn measure() {
        let variant = std::env::var("KR1_VARIANT").expect("KR1_VARIANT");
        let dist = PathBuf::from(std::env::var("KR1_DIST").expect("KR1_DIST"));
        let data = PathBuf::from(std::env::var("KR1_DATA_ROOT").expect("KR1_DATA_ROOT"));
        let journey_path = PathBuf::from(std::env::var("KR1_JOURNEY").expect("KR1_JOURNEY"));
        let journey: Journey = serde_json::from_slice(&std::fs::read(journey_path).unwrap()).unwrap();
        let mode = std::env::var("KR1_MODE").unwrap_or_else(|_| "journey".into());

        let started = Instant::now();
        let runtime = Runtime::boot(args(&dist, data)).unwrap();
        let boot_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let mut bench = Bench { rt: runtime };
        let first_started = Instant::now();
        let (first_js, _) = bench.frame(journey.masks[0]);
        let startup_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let first_total = first_started.elapsed().as_secs_f64() * 1_000.0;
        let (used, malloc, objects) = qjs_memory(&bench.rt.guest);
        println!(
            "KR1_BOOT variant={variant} js_bytes={} pak_bytes={} boot_ms={boot_ms:.3} first_js_ms={first_js:.3} first_total_ms={first_total:.3} startup_first_ms={startup_ms:.3} qjs_used_mib={:.3} qjs_malloc_mib={:.3} objects={objects} rss_mib={:.3} reads={}",
            std::fs::metadata(dist.join("main.js")).unwrap().len(),
            std::fs::metadata(dist.join("main.pak")).unwrap().len(),
            used as f64 / 1_048_576.0,
            malloc as f64 / 1_048_576.0,
            rss_kib() as f64 / 1024.0,
            bench.reads(),
        );
        if mode == "boot" {
            let gc_ms = collect_qjs(&bench.rt.guest);
            let (retained_used, retained_malloc, retained_objects) = qjs_memory(&bench.rt.guest);
            println!(
                "KR1_BOOT_GC variant={variant} gc_ms={gc_ms:?} qjs_retained_mib={:.3} qjs_malloc_mib={:.3} objects={retained_objects}",
                retained_used as f64 / 1_048_576.0,
                retained_malloc as f64 / 1_048_576.0,
            );
            return;
        }

        let mut last_map = bench.map();
        let mut transfers = Vec::new();
        for (index, mask) in journey.masks.iter().copied().enumerate().skip(1) {
            let (js_ms, total_ms) = bench.frame(mask);
            let map = bench.map();
            if map != last_map {
                transfers.push(Sample {
                    frame: index,
                    from: last_map,
                    to: map.clone(),
                    js_ms,
                    total_ms,
                    reads: bench.reads(),
                });
                last_map = map;
            }
        }
        assert_eq!(last_map, "spyder_route1");
        assert_eq!(transfers.len(), 5);
        for sample in &transfers {
            println!(
                "KR1_TRANSFER variant={variant} frame={} from={} to={} qjs_ms={:.3} total_ms={:.3} reads={}",
                sample.frame, sample.from, sample.to, sample.js_ms, sample.total_ms, sample.reads,
            );
        }
        let worst = transfers.iter().max_by(|a, b| a.total_ms.partial_cmp(&b.total_ms).unwrap()).unwrap();
        let state = bench.string("JSON.stringify(globalThis.__rpgSessionState)");
        let (end_used, end_malloc, end_objects) = qjs_memory(&bench.rt.guest);
        println!(
            "KR1_END variant={variant} frames={} transfers={} map={} state_fnv64={:016x} worst_transfer_frame={} worst_transfer_ms={:.3} worst_transfer_qjs_ms={:.3} qjs_used_mib={:.3} qjs_malloc_mib={:.3} objects={} reads={}",
            journey.masks.len(), transfers.len(), last_map, fnv1a64(state.as_bytes()),
            worst.frame, worst.total_ms, worst.js_ms,
            end_used as f64 / 1_048_576.0, end_malloc as f64 / 1_048_576.0,
            end_objects, bench.reads(),
        );
        let gc_ms = collect_qjs(&bench.rt.guest);
        let (retained_used, retained_malloc, retained_objects) = qjs_memory(&bench.rt.guest);
        println!(
            "KR1_END_GC variant={variant} gc_ms={gc_ms:?} qjs_retained_mib={:.3} qjs_malloc_mib={:.3} objects={retained_objects} reads={}",
            retained_used as f64 / 1_048_576.0,
            retained_malloc as f64 / 1_048_576.0,
            bench.reads(),
        );
    }
}
