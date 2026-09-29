// Included into a scratch copy of PocketJS's desktop host by
// bench-battle-quickjs.sh. It evaluates the real battle reducer + adapted
// GB1 database (bundled by tools/battle-oracle/bench-entry.ts) in a bare
// rquickjs `Guest` — no window, no `UiSurface`, no Bun/JSC execution
// measured. `__benchNow` is bound to a native `Instant`-backed clock so the
// bundle's own timing loop measures real QuickJS wall time.
#[cfg(test)]
mod battle_quickjs_bench {
    use super::*;
    use pocket_mod::qjs::Function;
    use std::time::Instant;

    #[test]
    #[ignore]
    fn run() {
        let js_path =
            std::env::var("GB2_BENCH_JS").expect("GB2_BENCH_JS points at the built battle-bench.js");
        let source = std::fs::read_to_string(&js_path).expect("read battle-bench.js");

        let guest = Guest::new().expect("QuickJS guest");
        let start = Instant::now();
        guest
            .with(|ctx| -> anyhow::Result<()> {
                ctx.globals().set(
                    "__benchNow",
                    Function::new(ctx.clone(), move || start.elapsed().as_secs_f64() * 1_000.0)?,
                )?;
                Ok(())
            })
            .expect("bind __benchNow");

        guest.eval("battle-bench", &source).expect("eval battle-bench.js");

        let output: String = guest
            .with(|ctx| ctx.eval::<String, _>("globalThis.__out"))
            .expect("read globalThis.__out");
        println!("{output}");
    }
}
