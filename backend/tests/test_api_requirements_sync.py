from pathlib import Path

from packaging.requirements import Requirement


def _requirements_lines(path: Path):
    return path.read_text(encoding="utf-8").splitlines()


def test_api_requirements_match_backend_requirements():
    repo_root = Path(__file__).resolve().parents[2]
    backend_requirements = _requirements_lines(repo_root / "backend" / "requirements.txt")
    api_requirements = _requirements_lines(repo_root / "api" / "requirements.txt")

    assert api_requirements == backend_requirements


def test_api_requirements_parse_standalone():
    repo_root = Path(__file__).resolve().parents[2]
    api_requirements_path = repo_root / "api" / "requirements.txt"
    api_requirements = _requirements_lines(api_requirements_path)

    assert all(not line.startswith(("-r ", "--requirement ")) for line in api_requirements)

    for line in api_requirements:
        if not line or line.startswith("#"):
            continue
        Requirement(line)
