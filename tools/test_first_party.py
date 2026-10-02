import unittest

from check_first_party import violations


class FirstPartyTest(unittest.TestCase):
    def test_loading_positions_fail(self):
        self.assertTrue(violations('@font-face{src:url(https://fonts.example/font.woff2)}', '.css'))
        self.assertTrue(violations("fetch('https://data.example/feed.json')", '.js'))
        self.assertTrue(violations('<link rel="preconnect" href="https://fonts.example">', '.html'))

    def test_reader_links_are_allowed(self):
        self.assertFalse(violations('<a href="https://example.org/paper">paper</a>', '.html'))
        self.assertFalse(violations('<link rel="canonical" href="https://pinkrobotics.ca/">', '.html'))


if __name__ == '__main__':
    unittest.main()
