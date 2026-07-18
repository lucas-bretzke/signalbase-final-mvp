from __future__ import annotations

import os
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_ROOT))

from app import main  # noqa: E402


class FakeFrame:
    def __init__(self, records):
        self.records = records

    def to_dict(self, orient):
        if orient != "records":
            raise ValueError(orient)
        return self.records


class FakeLinkedInAccount:
    lock = threading.Lock()
    active = 0
    max_active = 0
    calls = []
    failures = set()
    results = {}
    delay = 0.03

    def __init__(self, session_file, log_level):
        self.session_file = session_file
        self.log_level = log_level

    def scrape_staff(self, company_name, search_term, extra_profile_data, max_results, connect, block):
        with self.lock:
            type(self).active += 1
            type(self).max_active = max(type(self).max_active, type(self).active)
            type(self).calls.append(search_term)

        try:
            time.sleep(type(self).delay)
            if search_term in type(self).failures:
                raise RuntimeError(f"{search_term} failed")
            return FakeFrame(type(self).results.get(search_term, [])[:max_results])
        finally:
            with self.lock:
                type(self).active -= 1


class StaffSpyParallelSearchTest(unittest.TestCase):
    def setUp(self):
        FakeLinkedInAccount.active = 0
        FakeLinkedInAccount.max_active = 0
        FakeLinkedInAccount.calls = []
        FakeLinkedInAccount.failures = set()
        FakeLinkedInAccount.results = {}
        main._STAFFSPY_ACCOUNTS.clear()
        main._STAFFSPY_GLOBAL_SEMAPHORE = None
        main._STAFFSPY_GLOBAL_LIMIT = 0

    def run_search(self, *, keywords, max_results=8, env=None):
        payload = main.DecisionMakerRequest(
            company_name="Acme",
            linkedin_url="https://www.linkedin.com/company/acme",
            domain="acme.com",
            keywords=keywords,
            max_results=max_results,
        )
        with mock.patch.dict(os.environ, env or {}, clear=False):
            return main.run_staffspy_keyword_search(
                account_cls=FakeLinkedInAccount,
                session_path=Path("session.pkl"),
                payload=payload,
                max_per_keyword=8,
                extra_profile_data=False,
            )

    def test_dedupes_people_and_respects_max_results(self):
        FakeLinkedInAccount.results = {
            "CEO": [
                {"name": "Ana", "title": "CEO", "profile_link": "https://linkedin.com/in/ana"},
            ],
            "Founder": [
                {"name": "Ana Again", "title": "Founder", "profile_link": "https://linkedin.com/in/ana"},
                {"name": "Bia", "title": "Founder", "profile_link": "https://linkedin.com/in/bia"},
            ],
        }

        result = self.run_search(
            keywords=["CEO", "Founder"],
            max_results=2,
            env={"STAFFSPY_KEYWORD_CONCURRENCY": "2", "STAFFSPY_GLOBAL_CONCURRENCY": "2"},
        )

        self.assertEqual(len(result["rows"]), 2)
        self.assertEqual([row["linkedin_url"] for row in result["rows"]], ["https://linkedin.com/in/ana", "https://linkedin.com/in/bia"])

    def test_keyword_failure_adds_warning_and_keeps_other_results(self):
        FakeLinkedInAccount.results = {
            "CEO": [
                {"name": "Ana", "title": "CEO", "profile_link": "https://linkedin.com/in/ana"},
            ],
        }
        FakeLinkedInAccount.failures = {"Founder"}

        result = self.run_search(
            keywords=["CEO", "Founder"],
            env={"STAFFSPY_KEYWORD_CONCURRENCY": "2", "STAFFSPY_GLOBAL_CONCURRENCY": "2"},
        )

        self.assertEqual(len(result["rows"]), 1)
        self.assertEqual(result["rows"][0]["name"], "Ana")
        self.assertTrue(any("Founder" in warning for warning in result["warnings"]))

    def test_keyword_concurrency_limit_is_respected(self):
        FakeLinkedInAccount.results = {
            keyword: [{"name": keyword, "title": keyword, "profile_link": f"https://linkedin.com/in/{keyword.lower()}"}]
            for keyword in ["CEO", "Founder", "CTO", "Diretor"]
        }

        result = self.run_search(
            keywords=["CEO", "Founder", "CTO", "Diretor"],
            max_results=4,
            env={"STAFFSPY_KEYWORD_CONCURRENCY": "2", "STAFFSPY_GLOBAL_CONCURRENCY": "2"},
        )

        self.assertEqual(len(result["rows"]), 4)
        self.assertEqual(FakeLinkedInAccount.max_active, 2)

    def test_does_not_start_more_keywords_after_max_results_is_reached(self):
        FakeLinkedInAccount.results = {
            keyword: [{"name": keyword, "title": keyword, "profile_link": f"https://linkedin.com/in/{keyword.lower()}"}]
            for keyword in ["CEO", "Founder", "CTO", "Diretor"]
        }

        result = self.run_search(
            keywords=["CEO", "Founder", "CTO", "Diretor"],
            max_results=1,
            env={"STAFFSPY_KEYWORD_CONCURRENCY": "2", "STAFFSPY_GLOBAL_CONCURRENCY": "2"},
        )

        self.assertEqual(len(result["rows"]), 1)
        self.assertLessEqual(len(FakeLinkedInAccount.calls), 2)


class DemoLocalCompanyTest(unittest.TestCase):
    def test_generates_stable_profile_for_unknown_local_company(self):
        payload = main.CompanyExtractRequest(
            linkedin_url="https://www.linkedin.com/company/padaria-floripa",
            cnpj="12345678000190",
            company_name="Padaria Floripa Ltda",
            domain="padariafloripa.com.br",
            city="Florianopolis",
            uf="SC",
            cnae="1091102",
        )

        with mock.patch.dict(os.environ, {"LINKEDIN_WORKER_MODE": "demo"}, clear=False):
            first = main.extract_company(payload)
            second = main.extract_company(payload)

        self.assertEqual(first, second)
        self.assertTrue(first["success"])
        self.assertEqual(first["name"], "Padaria Floripa Ltda")
        self.assertEqual(first["headquarters"], "Florianopolis, SC")
        self.assertEqual(first["method_used"], "demo_generated")

    def test_uses_first_partner_and_generates_corporate_contact(self):
        payload = main.DecisionMakerRequest(
            company_name="Padaria Floripa Ltda",
            linkedin_url="https://www.linkedin.com/company/padaria-floripa",
            domain="https://www.padariafloripa.com.br/contato",
            cnpj="12345678000190",
            partner_names=["João da Silva - Sócio Administrador", "Maria Souza"],
            max_results=3,
        )

        with mock.patch.dict(os.environ, {"LINKEDIN_WORKER_MODE": "demo"}, clear=False):
            first = main.search_decision_makers(payload)
            second = main.search_decision_makers(payload)

        self.assertEqual(first, second)
        person = first["decision_makers"][0]
        self.assertEqual(person["name"], "João da Silva")
        self.assertTrue(person["partner_match"])
        self.assertEqual(person["partner_match_confidence"], 100)
        self.assertEqual(person["emails"], ["joao.da.silva@padariafloripa.com.br"])
        self.assertRegex(person["phones"][0], r"^\+55 \d{2} 9\d{4}-\d{4}$")

    def test_generates_decision_maker_without_fixture_or_partner(self):
        payload = main.DecisionMakerRequest(
            company_name="Empresa Local Generica",
            linkedin_url="https://www.linkedin.com/company/empresa-local-generica",
            domain="empresa.local.br",
            cnpj="98765432000110",
            max_results=1,
        )

        with mock.patch.dict(os.environ, {"LINKEDIN_WORKER_MODE": "demo"}, clear=False):
            result = main.search_decision_makers(payload)

        self.assertEqual(len(result["decision_makers"]), 1)
        self.assertEqual(result["decision_makers"][0]["source"], "demo_generated")

    def test_partner_annotation_is_additive_for_real_staffspy_rows(self):
        rows = [{"name": "Joao P. da Silva", "title": "CEO", "source": "staffspy"}]

        annotated = main.annotate_partner_matches(rows, ["Joao P. da Silva"])

        self.assertEqual(annotated[0]["source"], "staffspy")
        self.assertTrue(annotated[0]["partner_match"])
        self.assertEqual(annotated[0]["matched_partner_name"], "Joao P. da Silva")


if __name__ == "__main__":
    unittest.main()
