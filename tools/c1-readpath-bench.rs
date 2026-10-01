// C1 read-path decomposition: times each stage of a sharded map first
// visit inside the real rquickjs Guest — host file read, the host fs
// handler (disk chunk + base64 encode + envelope JSON) called directly on
// the mount, the JS-observed chunk transfer, envelope parse, base64
// decode, concat, ASCII decode, JSON.parse, validate/derive, then the
// production staged pipeline, commit and the first frames. Rust Instant
// around evals; included into the desktop host by tools/bench-c1-readpath.sh.
#[cfg(test)]
mod c1_readpath {
    use super::*;
    use std::time::Instant;

    const BENCH_APP_ID: &str = "dev.lfkdsk.c1-bench";

    fn args(dist: &PathBuf, data: PathBuf) -> Args {
        Args {
            app: "c1-readpath-entry".into(),
            js: Some(dist.join("c1-readpath-entry.js")),
            pak: Some(dist.join("c1-readpath-entry.pak")),
            file: None,
            data_root: Some(data),
            app_id: Some(BENCH_APP_ID.into()),
            title: "C1 readpath".into(),
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

    #[derive(Deserialize)]
    struct C1MapMeta {
        id: String,
        entry: String,
    }

    struct Bench {
        rt: Runtime,
    }

    impl Bench {
        fn string(&self, source: &str) -> String {
            self.rt.guest.with(|ctx| match ctx.eval::<String, _>(source) {
                Ok(v) => v,
                Err(e) => {
                    let msg = ctx.catch().as_exception().map(|x| format!("{:?}", x.message()));
                    panic!("QuickJS eval failed: {e} {msg:?} source={source}")
                }
            })
        }

        fn boolean(&self, source: &str) -> bool {
            self.rt.guest.with(|ctx| match ctx.eval::<bool, _>(source) {
                Ok(v) => v,
                Err(e) => {
                    let msg = ctx.catch().as_exception().map(|x| format!("{:?}", x.message()));
                    panic!("QuickJS eval failed: {e} {msg:?} source={source}")
                }
            })
        }

        fn timed_unit(&self, source: &str) -> f64 {
            let started = Instant::now();
            self.string(source);
            started.elapsed().as_secs_f64() * 1_000.0
        }

        fn timed_bool(&self, source: &str) -> (bool, f64) {
            let started = Instant::now();
            let value = self.boolean(source);
            (value, started.elapsed().as_secs_f64() * 1_000.0)
        }

        fn gc(&self) -> f64 {
            let started = Instant::now();
            self.rt.guest.with(|ctx| unsafe {
                let runtime = pocket_mod::qjs::qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
                pocket_mod::qjs::qjs::JS_RunGC(runtime);
            });
            started.elapsed().as_secs_f64() * 1_000.0
        }

        fn frame(&mut self, mask: u32) -> f64 {
            self.rt.buttons = mask;
            self.rt._audio_host.begin_tick();
            self.rt.audio.begin_tick();
            self.rt.offload.begin_frame();
            let a = Instant::now();
            self.rt.guest.frame(mask).expect("QuickJS frame");
            self.rt.surface.tick();
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
            a.elapsed().as_secs_f64() * 1_000.0
        }
    }

    fn seed_maps(source: &PathBuf, data_root: &PathBuf) {
        let destination = data_root.join(BENCH_APP_ID).join("data").join("maps");
        let _ = std::fs::remove_dir_all(&destination);
        std::fs::create_dir_all(&destination).expect("create benchmark map data directory");
        for entry in std::fs::read_dir(source).expect("read C1_MAPS") {
            let entry = entry.expect("map dir entry");
            let path = entry.path();
            if !entry.file_type().expect("read map entry type").is_file()
                || !matches!(
                    path.extension().and_then(|value| value.to_str()),
                    Some("json" | "rkm")
                )
            {
                continue;
            }
            std::fs::copy(&path, destination.join(entry.file_name())).expect("copy map entry");
        }
    }

    #[test]
    #[ignore]
    fn readpath() {
        let dist = PathBuf::from(std::env::var("C1_DIST").expect("C1_DIST"));
        let maps = PathBuf::from(std::env::var("C1_MAPS").expect("C1_MAPS"));
        let bench_root = PathBuf::from(std::env::var("C1_BENCH_ROOT").expect("C1_BENCH_ROOT"));
        let data = bench_root.join(format!("c1-map-data-{}", std::process::id()));
        seed_maps(&maps, &data);
        let runtime = Runtime::boot(args(&dist, data.clone())).unwrap();
        let mut bench = Bench { rt: runtime };
        bench.frame(0);
        let metadata: Vec<C1MapMeta> =
            serde_json::from_str(&bench.string("JSON.stringify(globalThis.__c1ReadBench.maps)"))
                .expect("map metadata");
        let selection: Vec<String> = std::env::var("C1_MAPS_SELECT")
            .map(|v| {
                v.split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let reps: usize = std::env::var("C1_REPS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(11);
        // Force one-time session creation (common-event compile, extension
        // registry) outside every timed stage.
        bench.string("(globalThis.__c1ReadBench.warmup(), 'ok')");
        let fs_mount = bench.rt._fs.clone();
        for meta in metadata
            .iter()
            .filter(|m| selection.is_empty() || selection.contains(&m.id))
        {
            let id = serde_json::to_string(&meta.id).unwrap();
            let entry = meta.entry.as_str();
            let file = maps.join(&entry["maps/".len()..]);
            let bytes = std::fs::metadata(&file).expect("map entry metadata").len() as usize;
            let chunks = (bytes + 65_535) / 65_536;
            for rep in 0..reps {
                let _ = bench.gc();
                // S1: pure host disk read of the whole file (page-cache floor).
                let t_disk = {
                    let s = Instant::now();
                    let _ = std::fs::read(&file).expect("host read");
                    s.elapsed().as_secs_f64() * 1_000.0
                };
                // S1b: the host fs handler per chunk (disk chunk read +
                // base64 encode + envelope JSON build), called directly on
                // the same mount the guest's globalThis.fs closures share.
                let mut t_host = 0.0f64;
                for i in 0..chunks {
                    let s = Instant::now();
                    let envelope = fs_mount
                        .borrow_mut()
                        .read(entry, (i * 65_536) as i64, 65_536);
                    t_host += s.elapsed().as_secs_f64() * 1_000.0;
                    if rep == 0 && i == 0 {
                        let value: serde_json::Value =
                            serde_json::from_str(&envelope).expect("host envelope json");
                        assert!(value["data"]["$b"].is_string(), "host envelope carries blob");
                    }
                }
                // S2-S4: the JS-observed readAll loop, one eval per stage.
                bench.string("(globalThis.__c1ReadBench.resetScratch(), 'ok')");
                let mut t_transfer = 0.0f64;
                let mut t_env_parse = 0.0f64;
                let mut t_b64 = 0.0f64;
                for i in 0..chunks {
                    t_transfer += bench.timed_unit(&format!(
                        "String(globalThis.__c1ReadBench.readChunk({entry:?}, {}))",
                        i * 65_536
                    ));
                    t_env_parse += bench
                        .timed_unit("String(globalThis.__c1ReadBench.parseEnvelope())");
                    t_b64 += bench.timed_unit("String(globalThis.__c1ReadBench.decodeChunk())");
                    bench.string("(globalThis.__c1ReadBench.pushChunk(), 'ok')");
                }
                let t_concat = bench.timed_unit("String(globalThis.__c1ReadBench.concatChunks())");
                let t_ascii = bench.timed_unit("String(globalThis.__c1ReadBench.decodeText())");
                let t_parse = bench.timed_unit("globalThis.__c1ReadBench.parseJson()");
                let t_validate = bench.timed_unit("(globalThis.__c1ReadBench.lightValidate(), 'ok')");
                let t_world = bench.timed_unit("String(globalThis.__c1ReadBench.buildWorld())");
                let t_passage =
                    bench.timed_unit("String(globalThis.__c1ReadBench.buildPassageTable())");
                // Cross-check: the production readFileSync path in one call.
                let t_prod_read = bench
                    .timed_unit(&format!("String(globalThis.__c1ReadBench.productionRead({entry:?}))"));
                // Production staged pipeline (the official bench's stages).
                bench.string(&format!("(globalThis.__c1ReadBench.begin({id}), 'ok')"));
                let (parsed, t_prep_parse) =
                    bench.timed_bool(&format!("globalThis.__c1ReadBench.step({id})"));
                let (validated, t_prep_validate) =
                    bench.timed_bool(&format!("globalThis.__c1ReadBench.step({id})"));
                let (compiled, t_prep_compile) =
                    bench.timed_bool(&format!("globalThis.__c1ReadBench.step({id})"));
                assert!(!parsed, "{id} parse step must remain staged");
                assert!(!validated, "{id} validation step must remain staged");
                assert!(compiled, "{id} compile step must complete preparation");
                let t_commit = bench.timed_unit(&format!(
                    "(globalThis.__c1ReadBench.commit({id}), 'ok')"
                ));
                let t_frame1 = bench.frame(0);
                let t_frame2 = bench.frame(0);
                bench.string(&format!("(globalThis.__c1ReadBench.begin({id}), 'ok')"));
                println!(
                    "C1_STAGE map={} rep={} bytes={bytes} chunks={chunks} disk={t_disk:.3} host={t_host:.3} transfer={t_transfer:.3} env_parse={t_env_parse:.3} b64={t_b64:.3} concat={t_concat:.3} ascii={t_ascii:.3} parse={t_parse:.3} validate={t_validate:.3} world={t_world:.3} passage={t_passage:.3} prod_read={t_prod_read:.3} prep_parse={t_prep_parse:.3} prep_validate={t_prep_validate:.3} prep_compile={t_prep_compile:.3} commit={t_commit:.3} frame1={t_frame1:.3} frame2={t_frame2:.3}",
                    meta.id, rep
                );
            }
        }
        let _ = std::fs::remove_dir_all(&data);
    }
}
