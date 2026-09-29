// Scout S2 render-architecture bench on the desktop host's QuickJS runtime.
// Same harness shape as scrub_bench.rs: boot the real desktop Runtime with the
// S2 prototype bundle, steer it through globalThis.__s2Cmd, time guest.frame()
// (JS) and surface.tick() (core) per frame.
//
//   POCKETJS_DIST=<dir with s2-proto.js/.pak> BENCH_W=480 BENCH_H=272
//   S2_MODE=chunks|nodes S2_MAP=taba_town S2_MAP2=buddha_mountain [BENCH_REPS=3]
//   [BENCH_DENSITY=1] [S2_MARGIN=16]
#[cfg(test)]
mod s2_bench {
    use super::*;
    use std::time::Instant;

    fn env_f(name: &str, d: f64) -> f64 {
        std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(d)
    }
    fn env_s(name: &str, d: &str) -> String {
        std::env::var(name).unwrap_or_else(|_| d.to_string())
    }
    fn qjs_used(guest: &Guest) -> (i64, i64, i64) {
        guest.with(|ctx| unsafe {
            let rt = pocket_mod::qjs::qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
            let mut u: pocket_mod::qjs::qjs::JSMemoryUsage = std::mem::zeroed();
            pocket_mod::qjs::qjs::JS_ComputeMemoryUsage(rt, &mut u);
            (u.memory_used_size, u.malloc_size, u.obj_count)
        })
    }
    fn gc_threshold(guest: &Guest) -> usize {
        guest.with(|ctx| unsafe {
            let rt = pocket_mod::qjs::qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
            pocket_mod::qjs::qjs::JS_GetGCThreshold(rt) as usize
        })
    }
    fn run_gc(guest: &Guest) {
        guest.with(|ctx| unsafe {
            let rt = pocket_mod::qjs::qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
            pocket_mod::qjs::qjs::JS_RunGC(rt);
        })
    }

    struct Sample { gc: bool, js: f64, core: f64 }

    fn stats(label: &str, v: &[Sample]) {
        if v.is_empty() { println!("CASE {label}: n=0"); return; }
        let mut js: Vec<f64> = v.iter().map(|s| s.js).collect();
        let mut core: Vec<f64> = v.iter().map(|s| s.core).collect();
        let n = js.len();
        let sum: f64 = js.iter().sum();
        let csum: f64 = core.iter().sum();
        js.sort_by(|a, b| a.partial_cmp(b).unwrap());
        core.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let pct = |x: &Vec<f64>, p: f64| x[((n as f64 - 1.0) * p).ceil() as usize];
        println!(
            "CASE {label}: n={n} js mean={:.3}ms p50={:.3}ms p95={:.3}ms max={:.3}ms | core mean={:.3}ms max={:.3}ms | over8={} over16.7={} gcFrames={} maxNonGc={:.3}ms",
            sum / n as f64, pct(&js, 0.5), pct(&js, 0.95), js[n - 1],
            csum / n as f64, core[n - 1],
            js.iter().filter(|x| **x > 8.0).count(),
            js.iter().filter(|x| **x > 16.667).count(),
            v.iter().filter(|s| s.gc).count(),
            v.iter().filter(|s| !s.gc).map(|s| s.js).fold(0.0f64, f64::max),
        );
    }

    struct B { rt: Runtime }
    impl B {
        fn eval(&self, src: &str) {
            self.rt.guest.with(|ctx| { let _ = ctx.eval::<(), _>(src); });
        }
        fn state(&self) -> String {
            self.rt.guest.with(|ctx| ctx.eval::<String, _>("JSON.stringify(globalThis.__s2State||null)").unwrap_or_default())
        }
        fn frame(&mut self) -> (f64, f64) {
            self.rt.offload.begin_frame();
            let a = Instant::now();
            self.rt.guest.frame(0).unwrap();
            let b = Instant::now();
            self.rt.surface.tick();
            let c = Instant::now();
            for (id, error) in self.rt.supervisor.sync(&self.rt.surface).into_iter().chain(self.rt.supervisor.tick()) {
                log::error!("AppInstance {id}: {error}");
            }
            let _ = self.rt.surface.svc_drain();
            self.rt.ticks += 1;
            ((b - a).as_secs_f64() * 1000.0, (c - b).as_secs_f64() * 1000.0)
        }
        fn measured(&mut self, out: &mut Vec<Sample>) {
            let before = gc_threshold(&self.rt.guest);
            let (js, core) = self.frame();
            let gc = gc_threshold(&self.rt.guest) != before;
            out.push(Sample { gc, js, core });
        }
    }

    #[test]
    #[ignore]
    fn s2_render_bench() {
        let dist = PathBuf::from(std::env::var("POCKETJS_DIST").expect("POCKETJS_DIST"));
        let w = env_f("BENCH_W", 480.0);
        let h = env_f("BENCH_H", 272.0);
        let density = env_f("BENCH_DENSITY", 1.0) as u32;
        let reps = env_f("BENCH_REPS", 3.0) as usize;
        let mode = env_s("S2_MODE", "chunks");
        let map = env_s("S2_MAP", "taba_town");
        let map2 = env_s("S2_MAP2", "buddha_mountain");
        let margin = env_f("S2_MARGIN", 16.0);
        let data = PathBuf::from(format!("/var/tmp/fleet/task-1783/bench-data-{}", std::process::id()));
        let args = Args {
            app: "s2-proto".into(),
            js: Some(dist.join("s2-proto.js")),
            pak: Some(dist.join("s2-proto.pak")),
            file: None,
            data_root: Some(data.clone()),
            app_id: Some("dev.lfkdsk.pocket-tuxemon-s2-proto".into()),
            title: "bench".into(),
            viewport: (w as u32, h as u32),
            fixed: false,
            native_text: false,
            editor: false,
            companions: Vec::new(),
            system: None,
            svc_connect: None,
            density,
            script: Vec::new(),
            quit_after_ticks: None,
            storm: None,
            announce_ready: false,
            trace_frames: false,
        };
        let t0 = Instant::now();
        let rt = Runtime::boot(args).unwrap();
        let boot_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let mut b = B { rt };
        b.eval(&format!("globalThis.__s2Cmd={{mode:'{mode}',map:'{map}',scroll:false,margin:{margin}}}"));
        let t1 = Instant::now();
        let (first_js, _) = b.frame();
        let first_ms = t1.elapsed().as_secs_f64() * 1000.0;
        let (used, malloc, objs) = qjs_used(&b.rt.guest);
        println!(
            "BOOT mode={mode} map={map} viewport={w}x{h} density={density}: boot(eval+mount)={boot_ms:.1}ms firstFrame={first_ms:.1}ms (js {first_js:.2}ms) qjsUsed={:.2}MiB malloc={:.2}MiB objects={objs}",
            used as f64 / 1048576.0, malloc as f64 / 1048576.0
        );
        for _ in 0..10 { b.frame(); }
        println!("STATE settled {}", b.state());

        // (a) idle: nothing moves.
        let mut idle = Vec::new();
        for _ in 0..120 { b.measured(&mut idle); }
        stats("a idle", &idle);

        // (b) walking: the virtual player paces a bouncing diagonal 1 px/frame.
        b.eval("globalThis.__s2Cmd={scroll:true,vx:1,vy:1}");
        let mut walk = Vec::new();
        for _ in 0..600 { b.measured(&mut walk); }
        stats("b walk 1px/f (600f)", &walk);
        println!("STATE after walk {}", b.state());

        // (c) fast scroll: 4 px/frame on both axes (crosses tile rows every 4 frames, chunk edges often).
        b.eval("globalThis.__s2Cmd={scroll:true,vx:4,vy:4}");
        let mut fast = Vec::new();
        for _ in 0..600 { b.measured(&mut fast); }
        stats("c scroll 4px/f (600f)", &fast);
        b.eval("globalThis.__s2Cmd={scroll:false}");
        for _ in 0..5 { b.frame(); }

        // (d) map switches: the frame that rebuilds, then the 10 frames after it.
        let mut sw = Vec::new();
        let mut post = Vec::new();
        for _ in 0..reps {
            for target in [map2.as_str(), map.as_str()] {
                b.eval(&format!("globalThis.__s2Cmd={{map:'{target}',at:[64,64]}}"));
                b.measured(&mut sw);
                for _ in 0..10 { b.measured(&mut post); }
                println!("SWITCH -> {target} {}", b.state());
            }
        }
        stats("d switch frame", &sw);
        stats("e 10 frames after switch", &post);

        // (f) idle again after everything (steady-state heap).
        let mut idle2 = Vec::new();
        for _ in 0..120 { b.measured(&mut idle2); }
        stats("f idle after switches", &idle2);
        let (_, _, before) = qjs_used(&b.rt.guest);
        let mut gcs = vec![];
        for _ in 0..3 {
            let t = Instant::now();
            run_gc(&b.rt.guest);
            gcs.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        let (used, malloc, objs) = qjs_used(&b.rt.guest);
        println!(
            "END objectsBefore={before} forced JS_RunGC ms={:?} afterGC objects={objs} qjsUsed={:.2}MiB malloc={:.2}MiB",
            gcs.iter().map(|x| (x * 100.0).round() / 100.0).collect::<Vec<_>>(), used as f64 / 1048576.0, malloc as f64 / 1048576.0
        );
        println!("STATE end {}", b.state());
        let _ = std::fs::remove_dir_all(data);
    }
}
