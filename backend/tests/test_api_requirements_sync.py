from pathlib import Path

from packaging.requirements import Requirement


def _requirements_lines(path: Path):
    return path.read_text(encoding="utf-8").splitlines()


def _normalized_requirements(lines):
    normalized = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        normalized.append(str(Requirement(line)))
    return sorted(normalized)


def test_api_requirements_match_backend_requirements():
    repo_root = Path(__file__).resolve().parents[2]
    backend_requirements = _requirements_lines(repo_root / "backend" / "requirements.txt")
    api_requirements = _requirements_lines(repo_root / "api" / "requirements.txt")

    assert _normalized_requirements(api_requirements) == _normalized_requirements(
        backend_requirements
    )


def test_api_requirements_parse_standalone():
    repo_root = Path(__file__).resolve().parents[2]
    api_requirements_path = repo_root / "api" / "requirements.txt"
    api_requirements = _requirements_lines(api_requirements_path)

    stripped_requirements = [line.strip() for line in api_requirements]
    assert all(
        not line.startswith(("-r ", "--requirement ")) for line in stripped_requirements
    )

    for line in stripped_requirements:
        if not line or line.startswith("#"):
            continue
        Requirement(line)
