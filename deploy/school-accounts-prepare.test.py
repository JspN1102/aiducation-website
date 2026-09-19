import importlib.util
from pathlib import Path
import tempfile
import unittest
import openpyxl

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('school-accounts-prepare.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RosterTests(unittest.TestCase):
    def workbook(self, directory, student_rows, summary_rows=None):
        book = openpyxl.Workbook()
        sheet = book.active
        sheet.append(['26-27班別', '班號', '英文姓名 English Name', '中文姓名', '登入名稱', '登入密碼'])
        for row in student_rows:
            sheet.append(row)
        sheet.append([None] * 6)
        sheet.append(['班別', '人數'])
        for row in summary_rows or [['1A', len(student_rows)], ['總人數', len(student_rows)]]:
            sheet.append(row)
        book.create_sheet().append(['Test teacher', 'teacher-test'])
        target = Path(directory) / 'roster.xlsx'; book.save(target)
        return target

    def test_summary_rows_are_not_accounts_and_empty_password_needs_explicit_generation(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = self.workbook(temporary, [['1A', 1, 'Test A', 'A', 'student1', 'source-pass'], ['1A', 2, 'Test B', 'B', 'student2', ' ']])
            students, teachers, summary = module.classify(target)
            self.assertEqual(len(students), 1)
            self.assertEqual(len(teachers), 1)
            self.assertEqual(len(summary['rejected']), 1)
            students, _, summary = module.classify(target, True)
            self.assertEqual(len(students), 2)
            self.assertIsNone(students[1]['password'])
            self.assertEqual(students[1]['passwordSource'], 'generated_missing_password')
            self.assertEqual(summary['rowCategories']['class_summary'], 1)
            self.assertEqual(summary['rowCategories']['grand_total'], 1)

    def test_casefolded_duplicate_login_is_rejected_not_renamed(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = self.workbook(temporary, [['1A', 1, 'A', 'A', 'student1', 'x'], ['1A', 2, 'B', 'B', 'STUDENT1', 'y']])
            students, _, summary = module.classify(target, True)
            self.assertEqual(len(students), 1)
            self.assertEqual(summary['rejected'][0]['reason'], 'duplicate_login_or_class_number')

    def test_omitted_class_summary_does_not_erase_real_students(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = self.workbook(temporary, [['4F', 1, 'A', 'A', 'student1', 'x']], [['3F', 0], ['總人數', 0]])
            students, _, summary = module.classify(target, True)
            self.assertEqual(len(students), 1)
            self.assertEqual(summary['missingSummaryClasses'], ['4F'])
            self.assertEqual(summary['summaryTotal'], 0)


if __name__ == '__main__':
    unittest.main()
