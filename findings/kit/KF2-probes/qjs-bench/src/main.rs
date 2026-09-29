// Times the rpgkit session reducer under QuickJS (rquickjs 0.12, the engine
// the PocketJS desktop host embeds): one stepSession per G6 journey frame.
// argv: <bundle.js> <project.json> <journey.json> <messageBlocksPlayer 0|1> <reps>
use rquickjs::{Context, Function, Runtime};
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bundle = std::fs::read_to_string(&args[1]).expect("bundle");
    let project = std::fs::read_to_string(&args[2]).expect("project");
    let journey = std::fs::read_to_string(&args[3]).expect("journey");
    let mbp: bool = args[4] == "1";
    let reps: usize = args[5].parse().unwrap();
    let rt = Runtime::new().unwrap();
    rt.set_max_stack_size(8 * 1024 * 1024);
    let ctx = Context::full(&rt).unwrap();
    ctx.with(|ctx| {
        ctx.eval::<(), _>(bundle.as_str()).expect("eval bundle");
        let boot: Function = ctx.globals().get("__kf2Boot").unwrap();
        let step: Function = ctx.globals().get("__kf2Step").unwrap();
        let summary: Function = ctx.globals().get("__kf2Summary").unwrap();
        let t0 = Instant::now();
        let frames: i32 = boot.call((project.as_str(), journey.as_str(), mbp)).expect("boot");
        println!("BOOT {:.1} ms frames={}", t0.elapsed().as_secs_f64() * 1e3, frames);
        for rep in 0..reps {
            let reset: Function = ctx.globals().get("__kf2Reset").unwrap();
            let _: () = reset.call(()).unwrap();
            let mut samples: Vec<(f64, bool)> = Vec::with_capacity(frames as usize);
            for f in 0..frames {
                let a = Instant::now();
                let moving: bool = step.call((f,)).expect("step");
                samples.push((a.elapsed().as_secs_f64() * 1e3, moving));
            }
            let s: String = summary.call(()).unwrap();
            let stat = |v: &mut Vec<f64>| -> (f64, f64, f64, f64) {
                v.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let n = v.len();
                let p = |q: f64| v[((n as f64 - 1.0) * q).round() as usize];
                (p(0.5), p(0.95), v[n - 1], v.iter().sum::<f64>())
            };
            let mut all: Vec<f64> = samples.iter().map(|x| x.0).collect();
            let mut walk: Vec<f64> = samples.iter().filter(|x| x.1).map(|x| x.0).collect();
            let (p50, p95, max, total) = stat(&mut all);
            let (wp50, wp95, wmax, _) = stat(&mut walk);
            println!(
                "REP {} all p50 {:.3} p95 {:.3} max {:.3} total {:.0} ms | walking n={} p50 {:.3} p95 {:.3} max {:.3} | {}",
                rep, p50, p95, max, total, walk.len(), wp50, wp95, wmax, s
            );
        }
    });
}
