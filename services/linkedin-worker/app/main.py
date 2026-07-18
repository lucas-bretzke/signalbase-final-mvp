from __future__ import annotations

import hashlib
import os
import re
import threading
import time
import unicodedata
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel, Field

ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(ROOT_ENV, override=True)
load_dotenv()

app = FastAPI(title="SignalBase Final MVP LinkedIn Worker", version="2.0.0")

_STAFFSPY_SEMAPHORE_LOCK = threading.Lock()
_STAFFSPY_GLOBAL_SEMAPHORE: Optional[threading.BoundedSemaphore] = None
_STAFFSPY_GLOBAL_LIMIT = 0
_STAFFSPY_ACCOUNT_LOCK = threading.Lock()
_STAFFSPY_ACCOUNTS: Dict[tuple[str, int], Any] = {}

DECISION_KEYWORDS = [
    "CEO",
    "Founder",
    "Co-Founder",
    "Socio",
    "Socio",
    "Owner",
    "Diretor",
    "Diretora",
    "CTO",
    "Head of Technology",
    "Head of Sales",
    "Head of Growth",
]

DEMO_COMPANIES: Dict[str, Dict[str, Any]] = {
    "banco-do-brasil": {
        "success": True,
        "name": "Banco do Brasil",
        "description": "Instituicao financeira brasileira com operacao nacional em banco, credito, seguros e solucoes para empresas.",
        "website": "bb.com.br",
        "industry": "Banking",
        "company_size": "10,001+ employees",
        "employees_min": 10001,
        "employees_max": 50000,
        "headquarters": "Brasilia, DF, Brazil",
        "founded": "1808",
        "followers": "1.950.000",
        "method_used": "demo",
    },
    "tech-azul-solutions": {
        "success": True,
        "name": "Tech Azul Solutions",
        "description": "Plataforma B2B de automacao fiscal e dados comerciais para times de vendas consultivas.",
        "website": "techazul.com.br",
        "industry": "Software Development",
        "company_size": "51-200 employees",
        "employees_min": 51,
        "employees_max": 200,
        "headquarters": "Sao Paulo, SP, Brazil",
        "founded": "2018",
        "followers": "18.420",
        "method_used": "demo",
    },
    "vertice-cloud": {
        "success": True,
        "name": "Vertice Cloud",
        "description": "Consultoria cloud e seguranca para medias empresas com operacao nacional.",
        "website": "verticecloud.com.br",
        "industry": "IT Services and IT Consulting",
        "company_size": "11-50 employees",
        "employees_min": 11,
        "employees_max": 50,
        "headquarters": "Curitiba, PR, Brazil",
        "founded": "2020",
        "followers": "6.870",
        "method_used": "demo",
    },
    "orbital-pay": {
        "success": True,
        "name": "Orbital Pay",
        "description": "Fintech de pagamentos e conciliacao para operacoes B2B de alto volume.",
        "website": "orbitalpay.com.br",
        "industry": "Financial Services",
        "company_size": "201-500 employees",
        "employees_min": 201,
        "employees_max": 500,
        "headquarters": "Belo Horizonte, MG, Brazil",
        "founded": "2016",
        "followers": "31.200",
        "method_used": "demo",
    },
}

DEMO_DECISION_MAKERS: Dict[str, List[Dict[str, Any]]] = {
    "banco-do-brasil": [
        {
            "name": "Carolina Mendes",
            "title": "Diretora de Negocios Digitais PJ",
            "location": "Brasilia, DF",
            "linkedin_url": "https://www.linkedin.com/in/carolina-mendes-demo",
            "emails": [],
            "phones": [],
            "confidence": 82,
            "source": "demo_staffspy",
        }
    ],
    "tech-azul-solutions": [
        {
            "name": "Marina Costa",
            "title": "Founder & CEO",
            "location": "Sao Paulo, SP",
            "linkedin_url": "https://www.linkedin.com/in/marina-costa-demo",
            "emails": ["marina.costa@techazul.com.br"],
            "phones": ["+55 11 4002-1100"],
            "confidence": 96,
            "source": "demo_staffspy",
        },
        {
            "name": "Rafael Nogueira",
            "title": "CTO",
            "location": "Sao Paulo, SP",
            "linkedin_url": "https://www.linkedin.com/in/rafael-nogueira-demo",
            "emails": ["rafael@techazul.com.br"],
            "phones": [],
            "confidence": 89,
            "source": "demo_staffspy",
        },
    ],
    "vertice-cloud": [
        {
            "name": "Andre Valente",
            "title": "Socio Diretor",
            "location": "Curitiba, PR",
            "linkedin_url": "https://www.linkedin.com/in/andre-valente-demo",
            "emails": ["andre@verticecloud.com.br"],
            "phones": [],
            "confidence": 84,
            "source": "demo_staffspy",
        }
    ],
    "orbital-pay": [
        {
            "name": "Bianca Rocha",
            "title": "Chief Executive Officer",
            "location": "Belo Horizonte, MG",
            "linkedin_url": "https://www.linkedin.com/in/bianca-rocha-demo",
            "emails": ["bianca.rocha@orbitalpay.com.br"],
            "phones": ["+55 31 3555-4500"],
            "confidence": 94,
            "source": "demo_staffspy",
        }
    ],
}


class CompanyExtractRequest(BaseModel):
    linkedin_url: str
    cnpj: Optional[str] = None
    company_name: Optional[str] = None
    domain: Optional[str] = None
    city: Optional[str] = None
    uf: Optional[str] = None
    cnae: Optional[str] = None


class DecisionMakerRequest(BaseModel):
    company_name: str
    linkedin_url: Optional[str] = None
    domain: Optional[str] = None
    cnpj: Optional[str] = None
    partner_names: List[str] = Field(default_factory=list)
    keywords: List[str] = Field(default_factory=lambda: DECISION_KEYWORDS[:])
    max_results: int = 12


def worker_mode() -> str:
    return os.getenv("LINKEDIN_WORKER_MODE", "demo").strip().lower()


def slug_from_url(url: Optional[str]) -> str:
    if not url:
        return ""
    cleaned = url.strip().rstrip("/")
    m = re.search(r"linkedin\.com/company/([^/?#]+)", cleaned, re.I)
    if m:
        return m.group(1).lower()
    return cleaned.split("/")[-1].lower()


def normalize_string(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def ascii_key(value: Any) -> str:
    normalized = unicodedata.normalize("NFKD", normalize_string(value))
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii").lower()
    return " ".join(re.findall(r"[a-z0-9]+", ascii_value))


def stable_digest(*values: Any) -> str:
    seed = "|".join(ascii_key(value) for value in values if normalize_string(value)) or "signalbase-demo"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def slugify(value: Any) -> str:
    return ascii_key(value).replace(" ", "-").strip("-") or "empresa-demo"


def clean_domain(value: Optional[str]) -> Optional[str]:
    candidate = normalize_string(value).lower()
    if not candidate:
        return None
    candidate = re.sub(r"^https?://", "", candidate)
    candidate = candidate.split("/", 1)[0].split("@")[-1].split(":", 1)[0]
    candidate = re.sub(r"^www\.", "", candidate)
    if not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}", candidate):
        return None
    free_email_domains = {
        "gmail.com",
        "hotmail.com",
        "outlook.com",
        "yahoo.com",
        "yahoo.com.br",
        "icloud.com",
        "uol.com.br",
        "bol.com.br",
    }
    return None if candidate in free_email_domains else candidate


def clean_partner_name(value: Any) -> str:
    name = normalize_string(value)
    if not name:
        return ""
    # QSA exports sometimes concatenate the qualification after the person's name.
    parts = re.split(r"\s+(?:-|–|—|\|)\s+", name, maxsplit=1)
    if len(parts) == 2 and re.search(
        r"s[oó]ci|administr|diretor|president|titular|owner|founder|representante",
        parts[1],
        re.I,
    ):
        name = parts[0]
    return re.sub(r"\s+", " ", name).strip(" ,;-")


def demo_phone(seed: str) -> str:
    digest = stable_digest(seed)
    area_codes = [11, 21, 31, 41, 47, 48, 51, 61, 71, 81, 85]
    area_code = area_codes[int(digest[:2], 16) % len(area_codes)]
    suffix = 10000000 + (int(digest[2:10], 16) % 90000000)
    return f"+55 {area_code} 9{str(suffix)[:4]}-{str(suffix)[4:]}"


def demo_company(payload: CompanyExtractRequest, slug: str) -> Dict[str, Any]:
    company_name = normalize_string(payload.company_name) or slug.replace("-", " ").title()
    digest = stable_digest(payload.cnpj, company_name, slug)
    size_options = [
        (1, 10, "1-10 employees"),
        (11, 50, "11-50 employees"),
        (51, 200, "51-200 employees"),
        (201, 500, "201-500 employees"),
    ]
    employees_min, employees_max, company_size = size_options[int(digest[:2], 16) % len(size_options)]
    headquarters = ", ".join(value for value in [normalize_string(payload.city), normalize_string(payload.uf)] if value)
    domain = clean_domain(payload.domain)
    cnae_label = f" para o CNAE {payload.cnae}" if normalize_string(payload.cnae) else ""
    return {
        "success": True,
        "name": company_name,
        "description": f"Perfil demonstrativo deterministico de uma empresa local{cnae_label}.",
        "website": domain or None,
        "industry": "Empresa local (demo)",
        "company_size": company_size,
        "employees_min": employees_min,
        "employees_max": employees_max,
        "headquarters": headquarters or None,
        "founded": str(1990 + (int(digest[2:4], 16) % 34)),
        "followers": str(100 + (int(digest[4:10], 16) % 50000)),
        "method_used": "demo_generated",
    }


def demo_decision_maker(payload: DecisionMakerRequest) -> Dict[str, Any]:
    partners = [clean_partner_name(value) for value in payload.partner_names]
    partners = [value for value in partners if value]
    digest = stable_digest(payload.cnpj, payload.company_name, payload.linkedin_url)
    if partners:
        name = partners[0]
        title = "Socio(a) administrador(a)"
        source = "demo_partner_match"
    else:
        first_names = ["Ana", "Bruno", "Camila", "Diego", "Fernanda", "Gustavo"]
        last_names = ["Almeida", "Costa", "Martins", "Oliveira", "Rocha", "Silva"]
        name = (
            f"{first_names[int(digest[:2], 16) % len(first_names)]} "
            f"{last_names[int(digest[2:4], 16) % len(last_names)]}"
        )
        title = ["CEO", "Founder & CEO", "Diretor(a) Comercial"][int(digest[4:6], 16) % 3]
        source = "demo_generated"

    domain = clean_domain(payload.domain)
    email_local = ascii_key(name).replace(" ", ".")
    emails = [f"{email_local}@{domain}"] if domain and email_local else []
    phones = [demo_phone(f"{payload.cnpj}|{name}")] if payload.cnpj or domain else []
    return {
        "name": name,
        "title": title,
        "location": "",
        "linkedin_url": f"https://www.linkedin.com/in/{slugify(name)}-{digest[:6]}-demo",
        "emails": emails,
        "phones": phones,
        "confidence": 97 if partners else (88 if emails or phones else 80),
        "source": source,
        "partner_match": bool(partners),
        "matched_partner_name": partners[0] if partners else None,
        "partner_match_confidence": 100 if partners else 0,
    }


def partner_match(name: str, partner_names: List[str]) -> tuple[Optional[str], int]:
    person_key = ascii_key(name)
    if not person_key:
        return None, 0
    person_tokens = set(person_key.split())
    best_name: Optional[str] = None
    best_score = 0
    for raw_partner in partner_names:
        partner = clean_partner_name(raw_partner)
        partner_key = ascii_key(partner)
        if not partner_key:
            continue
        if partner_key == person_key:
            score = 100
        else:
            partner_tokens = set(partner_key.split())
            overlap = len(person_tokens & partner_tokens)
            ratio = overlap / max(1, max(len(person_tokens), len(partner_tokens)))
            score = 90 if overlap >= 2 and ratio >= 0.66 else 0
        if score > best_score:
            best_name = partner
            best_score = score
    return best_name, best_score


def annotate_partner_matches(people: List[Dict[str, Any]], partner_names: List[str]) -> List[Dict[str, Any]]:
    annotated: List[Dict[str, Any]] = []
    for person in people:
        row = dict(person)
        matched_name, match_confidence = partner_match(normalize_string(row.get("name")), partner_names)
        existing_confidence = safe_int(row.get("partner_match_confidence"), 0)
        if existing_confidence > match_confidence:
            matched_name = normalize_string(row.get("matched_partner_name")) or None
            match_confidence = existing_confidence
        row["partner_match"] = match_confidence > 0
        row["matched_partner_name"] = matched_name
        row["partner_match_confidence"] = match_confidence
        annotated.append(row)
    return sorted(annotated, key=lambda row: safe_int(row.get("partner_match_confidence"), 0), reverse=True)


def listify(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [normalize_string(v) for v in value if normalize_string(v)]
    if isinstance(value, tuple) or isinstance(value, set):
        return [normalize_string(v) for v in value if normalize_string(v)]
    if isinstance(value, str):
        if not value.strip():
            return []
        # StaffSpy sometimes returns comma-separated values.
        parts = re.split(r"[,;|]", value)
        return [p.strip() for p in parts if p.strip()]
    return [normalize_string(value)]


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def positive_env_int(name: str, default: int) -> int:
    return max(1, safe_int(os.getenv(name, str(default)), default))


def staffspy_global_semaphore() -> threading.BoundedSemaphore:
    global _STAFFSPY_GLOBAL_LIMIT, _STAFFSPY_GLOBAL_SEMAPHORE

    limit = positive_env_int("STAFFSPY_GLOBAL_CONCURRENCY", 2)
    with _STAFFSPY_SEMAPHORE_LOCK:
        if _STAFFSPY_GLOBAL_SEMAPHORE is None or _STAFFSPY_GLOBAL_LIMIT != limit:
            _STAFFSPY_GLOBAL_LIMIT = limit
            _STAFFSPY_GLOBAL_SEMAPHORE = threading.BoundedSemaphore(limit)
        return _STAFFSPY_GLOBAL_SEMAPHORE


def staffspy_account(session_path: Path, account_cls: Any) -> Any:
    # StaffSpy account objects may keep browser/session state; reuse per worker thread
    # instead of sharing one mutable account object across concurrent scrapes.
    key = (str(session_path), threading.get_ident())
    with _STAFFSPY_ACCOUNT_LOCK:
        account = _STAFFSPY_ACCOUNTS.get(key)
        if account is None:
            account = account_cls(session_file=str(session_path), log_level=1)
            _STAFFSPY_ACCOUNTS[key] = account
        return account


def scrape_staff_keyword(
    *,
    account_cls: Any,
    session_path: Path,
    company_name: str,
    domain: Optional[str],
    keyword: str,
    max_results: int,
    extra_profile_data: bool,
) -> Dict[str, Any]:
    try:
        with staffspy_global_semaphore():
            account = staffspy_account(session_path, account_cls)
            df = account.scrape_staff(
                company_name=company_name,
                search_term=keyword,
                extra_profile_data=extra_profile_data,
                max_results=max_results,
                connect=False,
                block=False,
            )
        return {
            "keyword": keyword,
            "people": [
                convert_staffspy_record(record, keyword=keyword, domain=domain)
                for record in dataframe_to_records(df)
            ],
            "warning": None,
        }
    except Exception as exc:
        return {
            "keyword": keyword,
            "people": [],
            "warning": f"Falha ao buscar '{keyword}': {exc}",
        }


def merge_people(
    rows: List[Dict[str, Any]],
    seen: set[str],
    people: List[Dict[str, Any]],
    max_results: int,
) -> None:
    if len(rows) >= max_results:
        return

    for person in people:
        key = (person.get("linkedin_url") or person.get("name") or "").lower()
        if not key or key in seen:
            continue
        seen.add(key)
        rows.append(person)
        if len(rows) >= max_results:
            break


def run_staffspy_keyword_search(
    *,
    account_cls: Any,
    session_path: Path,
    payload: DecisionMakerRequest,
    max_per_keyword: int,
    extra_profile_data: bool,
) -> Dict[str, Any]:
    if payload.max_results <= 0 or not payload.keywords:
        return {"rows": [], "warnings": []}

    keyword_concurrency = min(
        positive_env_int("STAFFSPY_KEYWORD_CONCURRENCY", 2),
        len(payload.keywords),
    )
    rows: List[Dict[str, Any]] = []
    warnings: List[str] = []
    seen: set[str] = set()
    completed: Dict[int, Dict[str, Any]] = {}
    next_keyword_index = 0
    next_merge_index = 0
    in_flight: Dict[Any, int] = {}

    def submit_next(executor: ThreadPoolExecutor) -> bool:
        nonlocal next_keyword_index
        if next_keyword_index >= len(payload.keywords) or len(rows) >= payload.max_results:
            return False

        remaining = max(1, payload.max_results - len(rows))
        keyword = payload.keywords[next_keyword_index]
        future = executor.submit(
            scrape_staff_keyword,
            account_cls=account_cls,
            session_path=session_path,
            company_name=payload.company_name,
            domain=payload.domain,
            keyword=keyword,
            max_results=min(max_per_keyword, remaining),
            extra_profile_data=extra_profile_data,
        )
        in_flight[future] = next_keyword_index
        next_keyword_index += 1
        return True

    def merge_completed_in_order() -> None:
        nonlocal next_merge_index
        while next_merge_index in completed:
            result = completed.pop(next_merge_index)
            if result.get("warning"):
                warnings.append(str(result["warning"]))
            merge_people(rows, seen, result.get("people", []), payload.max_results)
            next_merge_index += 1

    with ThreadPoolExecutor(max_workers=keyword_concurrency) as executor:
        while len(in_flight) < keyword_concurrency and submit_next(executor):
            pass

        while in_flight:
            done, _ = wait(in_flight.keys(), return_when=FIRST_COMPLETED)
            for future in done:
                index = in_flight.pop(future)
                completed[index] = future.result()

            merge_completed_in_order()

            while len(in_flight) < keyword_concurrency and submit_next(executor):
                pass

    merge_completed_in_order()
    return {"rows": rows, "warnings": warnings}


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "worker": "signalbase-final-mvp-linkedin-worker",
        "mode": worker_mode(),
        "company_extractor_available": is_company_extractor_available(),
        "staffspy_available": is_staffspy_available(),
        "time": int(time.time()),
    }


def is_company_extractor_available() -> bool:
    try:
        import linkedin_extractor  # noqa: F401
        return True
    except Exception:
        return False


def is_staffspy_available() -> bool:
    try:
        import staffspy  # noqa: F401
        return True
    except Exception:
        return False


@app.post("/company/extract")
def extract_company(payload: CompanyExtractRequest) -> Dict[str, Any]:
    slug = slug_from_url(payload.linkedin_url)
    if worker_mode() == "demo":
        data = DEMO_COMPANIES.get(slug) or demo_company(payload, slug)
        return {**data, "linkedin_url": payload.linkedin_url}

    try:
        from linkedin_extractor import scrape_company
    except Exception as exc:
        return {
            "success": False,
            "linkedin_url": payload.linkedin_url,
            "error": f"company-linkedin-info-extractor nao esta disponivel: {exc}",
            "method_used": "unavailable",
        }

    try:
        info = scrape_company(payload.linkedin_url)
        if not isinstance(info, dict):
            return {
                "success": False,
                "linkedin_url": payload.linkedin_url,
                "error": "Resposta inesperada do company-linkedin-info-extractor.",
                "method_used": "real",
            }
        return {"success": bool(info.get("success", True)), **info, "linkedin_url": payload.linkedin_url}
    except Exception as exc:
        return {
            "success": False,
            "linkedin_url": payload.linkedin_url,
            "error": str(exc),
            "method_used": "real_exception",
        }


@app.post("/decision-makers/search")
def search_decision_makers(payload: DecisionMakerRequest) -> Dict[str, Any]:
    slug = slug_from_url(payload.linkedin_url)
    if worker_mode() == "demo":
        fixture_people = [dict(person) for person in DEMO_DECISION_MAKERS.get(slug, [])]
        demo_payload = payload
        if not clean_domain(payload.domain):
            fixture_domain = clean_domain(normalize_string(DEMO_COMPANIES.get(slug, {}).get("website")))
            if fixture_domain:
                demo_payload = payload.model_copy(update={"domain": fixture_domain})

        if payload.partner_names:
            people = [demo_decision_maker(demo_payload), *fixture_people]
        elif fixture_people:
            people = fixture_people
        else:
            people = [demo_decision_maker(demo_payload)]

        people = annotate_partner_matches(people, payload.partner_names)
        max_results = max(0, payload.max_results)
        return {
            "success": True,
            "source": "demo_staffspy",
            "decision_makers": people[:max_results],
            "warnings": [] if max_results > 0 else ["max_results deve ser maior que zero para retornar decisores."],
        }

    session_file = os.getenv("LINKEDIN_SESSION_FILE", "services/linkedin-worker/session.pkl")
    session_path = Path(session_file)
    if not session_path.is_absolute():
        # Resolve relative to repository root when called from worker dir.
        session_path = Path.cwd().parent.parent / session_path

    if not session_path.exists():
        return {
            "success": False,
            "source": "staffspy",
            "decision_makers": [],
            "warnings": [
                f"Sessao do LinkedIn nao encontrada em {session_path}. Rode scripts/staffspy-login.py para criar session.pkl."
            ],
        }

    try:
        from staffspy import LinkedInAccount
    except Exception as exc:
        return {
            "success": False,
            "source": "staffspy",
            "decision_makers": [],
            "warnings": [f"StaffSpy nao esta disponivel: {exc}"],
        }

    max_per_keyword = safe_int(os.getenv("STAFFSPY_MAX_RESULTS_PER_KEYWORD", "8"), 8)
    extra_profile_data = os.getenv("STAFFSPY_EXTRA_PROFILE_DATA", "false").lower() == "true"

    try:
        result = run_staffspy_keyword_search(
            account_cls=LinkedInAccount,
            session_path=session_path,
            payload=payload,
            max_per_keyword=max_per_keyword,
            extra_profile_data=extra_profile_data,
        )
        return {
            "success": True,
            "source": "staffspy",
            "decision_makers": annotate_partner_matches(result["rows"], payload.partner_names),
            "warnings": result["warnings"],
        }
    except Exception as exc:
        return {
            "success": False,
            "source": "staffspy",
            "decision_makers": [],
            "warnings": [f"Erro geral StaffSpy: {exc}"],
        }


def dataframe_to_records(value: Any) -> List[Dict[str, Any]]:
    if value is None:
        return []
    if hasattr(value, "to_dict"):
        try:
            return value.to_dict("records")
        except Exception:
            pass
    if isinstance(value, list):
        return [v for v in value if isinstance(v, dict)]
    return []


def convert_staffspy_record(record: Dict[str, Any], keyword: str, domain: Optional[str]) -> Dict[str, Any]:
    name = normalize_string(record.get("name")) or " ".join(
        p for p in [normalize_string(record.get("first_name")), normalize_string(record.get("last_name"))] if p
    )
    title = (
        normalize_string(record.get("position"))
        or normalize_string(record.get("title"))
        or normalize_string(record.get("headline"))
        or keyword
    )
    linkedin_url = normalize_string(record.get("profile_link")) or normalize_string(record.get("linkedin_url"))
    emails = []
    for field in ["email_address", "potential_email", "email", "emails"]:
        emails.extend(listify(record.get(field)))
    emails = dedupe([e for e in emails if "@" in e])

    phones = []
    for field in ["phone_numbers", "phone", "phones", "telefone"]:
        phones.extend(listify(record.get(field)))
    phones = dedupe([p for p in phones if len(re.sub(r"\D", "", p)) >= 8])

    confidence = confidence_from_title(title, has_contact=bool(emails or phones))
    return {
        "name": name,
        "title": title,
        "location": normalize_string(record.get("location")),
        "linkedin_url": linkedin_url,
        "emails": emails,
        "phones": phones,
        "confidence": confidence,
        "source": "staffspy",
        "matched_keyword": keyword,
        "is_connection": bool(record.get("is_connection", False)),
        "raw_company": normalize_string(record.get("company")),
        "domain": domain,
    }


def dedupe(values: List[str]) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for value in values:
        key = value.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(value.strip())
    return out


def confidence_from_title(title: str, has_contact: bool = False) -> int:
    text = title.lower()
    score = 55
    strong = ["ceo", "chief executive", "founder", "co-founder", "socio", "socio", "owner", "fundador"]
    tech = ["cto", "technology", "tecnologia", "engenharia", "engineering"]
    director = ["diretor", "diretora", "director", "head", "vp", "vice president"]
    if any(term in text for term in strong):
        score += 30
    elif any(term in text for term in tech):
        score += 24
    elif any(term in text for term in director):
        score += 18
    if has_contact:
        score += 10
    return min(99, score)
