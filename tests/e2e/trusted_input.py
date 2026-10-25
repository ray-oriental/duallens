"""Real browser input helpers shared by the offline interaction runners."""


def touch_hold(page, selector, duration_ms=650):
    page.locator(selector).scroll_into_view_if_needed()
    box = page.locator(selector).bounding_box()
    assert box, selector
    cdp = page.context.new_cdp_session(page)
    try:
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [
            {'x': box['x'] + box['width'] / 2, 'y': box['y'] + min(12, box['height'] / 2)}]})
        page.wait_for_timeout(duration_ms)
    finally:
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        cdp.detach()
