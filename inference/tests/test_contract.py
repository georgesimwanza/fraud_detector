"""The pydantic contract must accept and reject exactly what the zod contract does (see contract/fixtures.json)."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas import FEATURE_ORDER, TransactionIn

FIXTURES = json.loads((Path(__file__).resolve().parents[2] / "contract" / "fixtures.json").read_text())


def test_feature_order():
    assert FEATURE_ORDER[0] == "Time" and FEATURE_ORDER[-1] == "Amount" and len(FEATURE_ORDER) == 30
    assert FEATURE_ORDER[1:29] == [f"V{i}" for i in range(1, 29)]


@pytest.mark.parametrize("case", FIXTURES["valid"], ids=lambda c: c["name"])
def test_valid(case):
    tx = TransactionIn.model_validate(case["payload"])
    dumped = tx.model_dump(exclude_unset=True)
    for key in case.get("stripped", []):
        assert key not in dumped
    assert len(tx.features()) == 30


@pytest.mark.parametrize("case", FIXTURES["invalid"], ids=lambda c: c["name"])
def test_invalid(case):
    with pytest.raises(ValidationError) as err:
        TransactionIn.model_validate(case["payload"])
    fields = {str(e["loc"][0]) for e in err.value.errors()}
    assert case["field"] in fields
