// Minimal in-browser test harness shared by all test modules.
// Results render on the page and are exposed on window.__testResults for automation.

const results = [];
let section = '';

export function describe(name) {
  section = name;
}

export function test(name, fn) {
  try {
    fn();
    results.push({ section, name, ok: true });
  } catch (err) {
    results.push({ section, name, ok: false, msg: err.message });
  }
}

export function near(actual, expected, tol, label = '') {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${label} expected ${expected} ± ${tol}, got ${actual}`);
  }
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function render() {
  window.__testResults = results;
  const passed = results.filter((r) => r.ok).length;
  const list = document.getElementById('results');
  let last = null;
  for (const r of results) {
    if (r.section !== last) {
      const h = document.createElement('li');
      h.className = 'section';
      h.textContent = r.section;
      list.appendChild(h);
      last = r.section;
    }
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : ' — ' + r.msg}`;
    list.appendChild(li);
  }
  document.getElementById('summary').textContent = `${passed}/${results.length} passed`;
  document.title = `${passed === results.length ? '✅' : '❌'} ${passed}/${results.length} tests`;
}
