import re

from mdu.core.enums import SHARED_NAMES
from mdu.core.env import REPO_ROOT

ENUMS_TS = REPO_ROOT / "packages" / "shared" / "src" / "enums.ts"


def shared_values(name: str) -> set[str]:
    text = ENUMS_TS.read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = \[(.*?)\] as const", text, re.S)
    assert m, f"{name} not found in {ENUMS_TS}"
    body = re.sub(r"//[^\n]*", "", m.group(1))
    return set(re.findall(r'"([^"]+)"', body))


def test_python_enum_values_exist_in_packages_shared() -> None:
    for name, values in SHARED_NAMES.items():
        missing = set(values) - shared_values(name)
        assert not missing, f"{name}: {sorted(missing)} not in packages/shared"
