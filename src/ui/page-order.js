// Keep a horizontal carousel's page elements in the given order with the
// fewest DOM moves. Re-inserting a scrollable element (even at the same
// position) resets its scrollTop in Chromium, so pages that are already in
// place must not be touched: otherwise every list-state refresh would send
// the active station list back to the top.
export function syncPageOrder(host, pages) {
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const current = host.children[index] ?? null;
    if (current === page) continue;
    const scrollTop = page.scrollTop;
    host.insertBefore(page, current);
    page.scrollTop = scrollTop;
  }
}
