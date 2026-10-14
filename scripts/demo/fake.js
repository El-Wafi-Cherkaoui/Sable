// Prints a scripted log for the demo: node fake.js <name>
const name = process.argv[2];
const scripts = {
  db: { lines: [
    [200, "PostgreSQL 16.4 starting"],
    [600, "listening on IPv4 address \"0.0.0.0\", port 5432"],
    [300, "database system is ready to accept connections"],
  ], idle: ["checkpoint complete: wrote 12 buffers", "autovacuum: processing \"orders\""] },
  api: { lines: [
    [300, "loading config from .env"],
    [400, "connected to postgres://localhost:5432/shop"],
    [300, "listening on http://localhost:3000"],
    [900, "GET /products 200 11ms"],
    [700, "GET /products/42 200 6ms"],
    [800, "POST /cart 201 19ms"],
    [600, "GET /cart 200 5ms"],
    [900, "POST /checkout 201 84ms"],
    [500, "!Error: payment provider timeout after 5000ms"],
    [80, "!    at chargeCard (src/payments/stripe.ts:48:11)"],
    [80, "!    at checkout (src/routes/checkout.ts:22:5)"],
    [400, "retrying payment (1/3)"],
    [700, "POST /checkout 201 312ms"],
    [600, "GET /orders/1081 200 9ms"],
  ], idle: ["GET /products 200 8ms", "GET /health 200 1ms", "GET /cart 200 4ms"] },
  web: { lines: [
    [400, "VITE v6.0.3  ready in 412 ms"],
    [100, "➜  Local:   http://localhost:5173/"],
    [100, "➜  Network: use --host to expose"],
  ], idle: ["hmr update /src/pages/Cart.tsx", "page reload src/main.tsx"] },
  migrate: { lines: [
    [300, "applying 2026_10_01_add_orders.sql"],
    [400, "applying 2026_10_09_add_coupons.sql"],
    [300, "2 migrations applied"],
  ], exit: 0 },
  test: { lines: [[500, "✓ cart (12 tests)"], [500, "✓ checkout (9 tests)"], [300, "21 passed"]], exit: 0 },
};
const s = scripts[name];
let i = 0;
function next() {
  if (i < s.lines.length) {
    const [delay, text] = s.lines[i++];
    setTimeout(() => {
      if (text.startsWith("!")) console.error(text.slice(1)); else console.log(text);
      next();
    }, delay);
  } else if (s.exit !== undefined) {
    process.exit(s.exit);
  } else {
    let k = 0;
    setInterval(() => console.log(s.idle[k++ % s.idle.length]), 2500);
  }
}
next();
