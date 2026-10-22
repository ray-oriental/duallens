"""Offline comparison invariants: never improve or hide a source measurement."""
import copy
import unittest
from compare_coverage import compare,missing_diff,markdown


class ComparisonTests(unittest.TestCase):
    def fixture(self):
        return {'metadata':{'probe_sha256':'same','coverage_version':3,'restore_version':2,
                            'timeout_seconds':25,'llm':'none','headed':False},
                'rows':[{'id':'fixture','device':'phone','coverage':.5,'covered':1,'total':2,
                         'initial_total':2,'t_first':.125,'status':'FAIL','missing':[]}]}

    def test_preserves_metrics_and_input(self):
        before=self.fixture();after=copy.deepcopy(before);after['rows'][0]['coverage']=.75
        rows=compare(before,after)
        self.assertEqual(rows[0]['baseline']['coverage'],.5)
        self.assertEqual(rows[0]['current']['coverage'],.75)
        self.assertEqual(before['rows'][0]['coverage'],.5)
        self.assertIn('| 50.0% | 75.0% | 0.125 | 0.125 |',markdown(rows))

    def test_refuses_changed_probe_or_deadline(self):
        for key,value in [('probe_sha256','different'),('timeout_seconds',95),('llm','configured'),('ack',False),('browser_version','different')]:
            before=self.fixture();after=copy.deepcopy(before);after['metadata'][key]=value
            with self.assertRaises(ValueError):compare(before,after)

    def test_refuses_missing_or_duplicate_cases(self):
        before=self.fixture();after=copy.deepcopy(before);after['rows']=[]
        with self.assertRaises(ValueError):compare(before,after)
        after=copy.deepcopy(before);after['rows']*=2
        with self.assertRaises(ValueError):compare(before,after)

    def test_missing_diff_preserves_repeated_nodes_and_exact_text(self):
        item={'selector':'#p','type':'p','text':'Original prose','reason':'untranslated'}
        diff=missing_diff([item,item],[item,{**item,'text':'Changed prose'}])
        self.assertEqual(diff['removed'],[item]);self.assertEqual(diff['shared'],[item])
        self.assertEqual(diff['added'][0]['text'],'Changed prose')

    def test_refuses_changed_device_emulation(self):
        before=self.fixture();after=copy.deepcopy(before)
        after['rows'][0]['emulation']={'width':800,'height':1280}
        with self.assertRaises(ValueError):compare(before,after)

    def test_unobserved_is_never_converted_to_zero(self):
        before=self.fixture();after=copy.deepcopy(before);after['rows'][0].update(coverage=None,t_first=None)
        self.assertIn('| 50.0% | — | 0.125 | — |',markdown(compare(before,after)))


if __name__=='__main__':unittest.main()
