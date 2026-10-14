"""Read retry boundaries; run with the external Playwright venv, no browser/model."""
import unittest
from playwright.sync_api import Error
from run_v031_live import read

class Page:
    def __init__(self,closed=False):self.closed=closed;self.waits=0
    def is_closed(self):return self.closed
    def wait_for_timeout(self,_):self.waits+=1

class NavigationReads(unittest.TestCase):
    def test_context_replaced_then_read_succeeds(self):
        page=Page();calls=[]
        def operation():
            calls.append(1)
            if len(calls)<3:raise Error('Execution context was destroyed, most likely because of a navigation')
            return ['stable reader']
        self.assertEqual(read(page,operation),['stable reader'])
        self.assertEqual(page.waits,2)

    def test_unrelated_error_and_closed_page_are_not_retried(self):
        for page,message in [(Page(),'Invalid selector'),(Page(True),'Execution context was destroyed')]:
            with self.assertRaises(Error):read(page,lambda:(_ for _ in ()).throw(Error(message)))
            self.assertEqual(page.waits,0)

    def test_read_retry_is_bounded(self):
        page=Page()
        with self.assertRaises(Error):read(page,lambda:(_ for _ in ()).throw(Error('Execution context was destroyed')),seconds=0)
        self.assertEqual(page.waits,0)

if __name__=='__main__':unittest.main()
