import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = await readFile(
  new URL("../src/pages/board/Elections.jsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/pages/board/Elections.css", import.meta.url),
  "utf8",
);

test("mobile schedule disclosure is a single accessible Schedule row and desktop remains expanded", () => {
  assert.match(component, /className="board-election-schedules is-desktop-schedule"/);
  assert.match(component, /<details\s+className="board-election-schedule-disclosure"/);
  assert.match(component, /<summary\s+aria-expanded=\{Boolean\(expandedElectionSchedules\[election\.id\]\)\}\s+aria-controls=\{`election-schedule-\$\{election\.id\}`\}/);
  assert.match(component, /<span>Schedule<\/span>/);
  assert.doesNotMatch(component, />\s*(?:View schedule|Show schedule|Hide schedule|Details)\s*</);
  assert.match(component, /open=\{Boolean\(expandedElectionSchedules\[election\.id\]\)\}/);
  assert.match(component, /onToggle=\{\(event\) =>/);
  assert.match(component, /id=\{`election-schedule-\$\{election\.id\}`\}/);
  assert.match(component, /<dt>Campaign<\/dt>[\s\S]*?<dt>Voting<\/dt>/);

  assert.match(styles, /\.board-election-schedule-disclosure\s*\{\s*display:\s*none;/);
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]*?\.board-election-schedules\.is-desktop-schedule\s*\{\s*display:\s*none;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]*?\.board-election-schedule-disclosure\s*\{\s*display:\s*block;/,
  );
  assert.match(styles, /\.board-election-schedule-disclosure > summary\s*\{[^}]*width:\s*100%/);
  assert.match(styles, /\.board-election-schedule-disclosure > summary:focus-visible/);
  assert.match(styles, /\.board-election-schedule-disclosure > summary:hover/);
  assert.match(styles, /\.board-election-schedule-disclosure\[open\] > summary::after/);
  assert.match(
    styles,
    /\.board-election-schedule-disclosure:not\(\[open\]\) > \.board-election-schedules\s*\{\s*display:\s*none;/,
  );
});

test("mobile election actions form one compact row with separate accessible targets", () => {
  assert.match(component, /onClick=\{\(\) => openWorkspace\(election\)\}[\s\S]*?aria-label=\{`Manage election/);
  assert.match(component, /onClick=\{\(\) => openEdit\(election\)\}[\s\S]*?aria-label=\{`Edit election/);
  assert.match(component, /onClick=\{\(\) => handleDelete\(election\.id\)\}[\s\S]*?aria-label=\{`Delete election/);
  assert.match(component, /board-election-cover\$\{hasCover \? "" : " is-empty"\}/);
  assert.match(styles, /\.board-election-identity-copy h3\s*\{[^}]*overflow-wrap:\s*anywhere/s);

  const mobileRules = styles.match(
    /@media \(max-width: 760px\) \{([\s\S]*?)\n\}\s*\n\n@media \(max-width: 430px\)/,
  )?.[1] || "";
  assert.match(mobileRules, /\.board-election-record-actions\s*\{[^}]*gap:\s*0\.25rem/s);
  assert.match(mobileRules, /\.board-election-action\.is-manage\s*\{[^}]*margin-right:\s*auto/s);
  assert.match(mobileRules, /\.board-election-action\.is-quiet,[\s\S]*?\.board-election-action\.is-danger\s*\{[^}]*min-height:\s*2\.75rem/s);
  assert.match(mobileRules, /\.board-election-action\.is-quiet,[\s\S]*?\.board-election-action\.is-danger\s*\{[^}]*border-color:\s*transparent/s);
  assert.match(mobileRules, /\.board-election-record\s*\{[^}]*row-gap:\s*0\.42rem[^}]*padding:\s*0\.55rem 0 0\.65rem/s);
  assert.match(mobileRules, /\.board-election-schedule-disclosure > summary\s*\{[^}]*min-height:\s*2\.75rem/s);
  assert.match(mobileRules, /\.board-election-action\.is-quiet,[\s\S]*?\.board-election-action\.is-danger\s*\{[^}]*margin-block:\s*-0\.2rem/s);
  assert.match(styles, /\.board-election-action\.is-danger\s*\{[^}]*color:\s*#9f1239/s);

  const narrowMobileRules = styles.match(
    /@media \(max-width: 430px\) \{([\s\S]*?)\n\}/,
  )?.[1] || "";
  assert.match(narrowMobileRules, /\.board-election-record\s*\{[^}]*row-gap:\s*0\.4rem/);
  assert.match(narrowMobileRules, /padding-block:\s*0\.5rem 0\.6rem/);
  assert.match(narrowMobileRules, /\.board-election-mobile-head\s*\{[^}]*column-gap:\s*0\.65rem/s);
});

test("phone layout combines Schedule and election actions in one utility row", () => {
  const utilityStart = component.indexOf('<div className="board-election-mobile-utility-row">');
  const disclosureStart = component.indexOf("<details", utilityStart);
  const actionsStart = component.indexOf('<div className="board-election-record-actions">', utilityStart);
  const utilityEnd = component.indexOf("</article>", utilityStart);
  assert.ok(utilityStart >= 0 && disclosureStart > utilityStart && actionsStart > disclosureStart);
  assert.ok(utilityEnd > actionsStart);

  const phoneRules = styles.match(
    /@media \(max-width: 600px\) \{([\s\S]*?)\n\}\s*\n\n@media \(max-width: 360px\)/,
  )?.[1] || "";
  assert.match(phoneRules, /\.board-election-mobile-utility-row\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\) 2\.75rem 2\.75rem/s);
  assert.match(phoneRules, /\.board-election-schedule-disclosure\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1/);
  assert.match(phoneRules, /\.board-election-schedule-disclosure\[open\]\s*\{[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(phoneRules, /\.board-election-schedule-disclosure > summary\s*\{[^}]*width:\s*max-content/);
  assert.match(phoneRules, /\.board-election-record-actions\s*\{[^}]*display:\s*contents/s);
  assert.match(phoneRules, /\.board-election-action\.is-manage\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1/s);
  assert.match(phoneRules, /\.board-election-action\.is-quiet\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1/s);
  assert.match(phoneRules, /\.board-election-action\.is-danger\s*\{[^}]*grid-column:\s*4;[^}]*grid-row:\s*1/s);
  assert.match(phoneRules, /\.board-election-action\.is-quiet,[\s\S]*?\.board-election-action\.is-danger\s*\{[^}]*min-height:\s*2\.75rem/s);

  const narrowRules = styles.match(/@media \(max-width: 360px\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(narrowRules, /\.board-election-mobile-utility-row\s*\{[^}]*column-gap:\s*0\.05rem/);
  assert.match(narrowRules, /\.board-election-action\.is-manage\s*\{[^}]*gap:\s*0\.2rem[^}]*padding-inline:\s*0\.12rem[^}]*font-size:\s*0\.68rem/s);
  assert.ok(320 <= 360, "320px receives the compact four-track layout and narrow spacing");
  for (const width of [375, 390, 430]) {
    assert.ok(width > 360 && width <= 600, `${width}px receives the four-track phone layout`);
  }
});
