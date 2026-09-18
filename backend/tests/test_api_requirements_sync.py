from pathlib import Path


def test_api_requirements_match_backend_requirements():
    repo_root = Path(__file__).resolve().parents[2]
    backend_requirements = (repo_root / "backend" / "requirements.txt").read_text(encoding="utf-8").splitlines()
    api_requirements = (repo_root / "api" / "requirements.txt").read_text(encoding="utf-8").splitlines()

    assert api_requirements == backend_requirements
