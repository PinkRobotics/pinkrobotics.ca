import unittest
import asyncio
import contextlib

from check_first_party import Browser, browser_check

from check_first_party import violations


class FirstPartyTest(unittest.TestCase):
    def test_loading_positions_fail(self):
        self.assertTrue(violations('@font-face{src:url(https://fonts.example/font.woff2)}', '.css'))
        self.assertTrue(violations("fetch('https://data.example/feed.json')", '.js'))
        self.assertTrue(violations('<link rel="preconnect" href="https://fonts.example">', '.html'))

    def test_reader_links_are_allowed(self):
        self.assertFalse(violations('<a href="https://example.org/paper">paper</a>', '.html'))
        self.assertFalse(violations('<link rel="canonical" href="https://pinkrobotics.ca/">', '.html'))


async def figure_keyboard(ws_url, origin):
    import websockets
    async with websockets.connect(ws_url, max_size=32_000_000) as ws:
        browser = Browser(ws, origin)
        try:
            for domain in ('Page', 'Runtime', 'Network'):
                await browser.send(domain + '.enable')
            await browser.send('Emulation.setDeviceMetricsOverride', {'width':1440, 'height':900, 'deviceScaleFactor':1, 'mobile':False})
            await browser.send('Fetch.enable', {'patterns': [{'urlPattern': '*'}]})
            await browser.navigate(f'http://{origin}/')
            async def value(expression):
                result = await browser.send('Runtime.evaluate',
                    {'expression': expression, 'returnByValue': True})
                if result.get('exceptionDetails'):
                    raise AssertionError('browser evaluation failed')
                return result['result'].get('value')
            async def key(name):
                for kind in ('keyDown', 'keyUp'):
                    await browser.send('Input.dispatchKeyEvent', {'type': kind, 'key': name})
            await value("document.documentElement.style.scrollBehavior='auto'")
            before = await value("document.getElementById('er0').textContent")
            await value("(document.getElementById('env-diameter') || document.getElementById('envcatch')).focus()")
            await key('ArrowRight')
            after = await value("document.getElementById('er0').textContent")
            print(f'Figure 2 keyboard: {before} -> {after}')
            assert before != after, 'ArrowRight did not change hull readout'
            assert after == '54 m hull', after
            await key('Home')
            assert await value("document.getElementById('er0').textContent") == '24 m hull'
            await key('End')
            assert await value("document.getElementById('er0').textContent") == '120 m hull'
            await key('ArrowLeft')
            assert await value("document.getElementById('er0').textContent") == '118 m hull'
            await value("document.getElementById('env-fraction').focus()")
            before = await value("document.getElementById('er1').textContent")
            await key('ArrowUp')
            assert await value("document.getElementById('er1').textContent") != before
            await key('Home')
            assert await value("Number(document.getElementById('env-fraction').value)") == .81
            await key('End')
            assert await value("Number(document.getElementById('env-fraction').value)") == 1.2
            await key('ArrowDown')
            assert abs(await value("Number(document.getElementById('env-fraction').value)") - 1.195) < .00001
            assert await value("getComputedStyle(document.getElementById('env-fraction')).outlineStyle") != 'none'
            assert (await value("document.getElementById('env-fraction').getAttribute('aria-valuetext')")).endswith(' t assumed mass')
            tree = await browser.send('Accessibility.getFullAXTree')
            sliders = [node for node in tree['nodes'] if node.get('role', {}).get('value') == 'slider']
            assert len(sliders) == 2
            assert {node['name']['value'] for node in sliders} == {'Hull diameter, metres', 'Assumed weight / calculated lift'}
            assert all('value' in node for node in sliders)
            # Pointer input still changes the same readout and synchronizes the sliders.
            await value("document.getElementById('envsvg').scrollIntoView({block:'center'})")
            point = await value("(() => {const r=document.getElementById('envsvg').getBoundingClientRect();return {x:r.left+r.width*.6,y:r.top+r.height*.4}})()")
            before = await value("document.getElementById('er0').textContent")
            for kind in ('mousePressed', 'mouseReleased'):
                await browser.send('Input.dispatchMouseEvent', dict(type=kind, button='left', clickCount=1, **point))
            assert await value("document.getElementById('er0').textContent") != before
            assert await value("Math.round(Number(document.getElementById('env-diameter').value)) + ' m hull'") == await value("document.getElementById('er0').textContent")
            assert not any(foreign for _, foreign in browser.requests)
        finally:
            browser.reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await browser.reader


class FigureKeyboardTest(unittest.TestCase):
    def test_native_keyboard_moves_figure_and_pointer_still_works(self):
        browser_check(figure_keyboard)


if __name__ == '__main__':
    unittest.main()
