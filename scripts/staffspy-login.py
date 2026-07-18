"""Cria/renova a sessão do StaffSpy.

Uso:
  ./.venv/bin/python scripts/staffspy-login.py

O StaffSpy abrirá o navegador para login. Depois do login, pressione Enter no terminal
quando solicitado pela própria biblioteca. O arquivo session.pkl será reutilizado pelo worker.
"""
from pathlib import Path
from staffspy import LinkedInAccount

ROOT = Path(__file__).resolve().parents[1]
SESSION = ROOT / "services" / "linkedin-worker" / "session.pkl"
SESSION.parent.mkdir(parents=True, exist_ok=True)

print(f"Salvando sessão em: {SESSION}")
account = LinkedInAccount(session_file=str(SESSION), log_level=1)
print("Sessão criada/carregada. Você já pode iniciar o worker em modo real.")
