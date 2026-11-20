from __future__ import annotations

from prompt_support import prompt_payload
from copy import deepcopy
from dataclasses import replace
import json
import pytest
from theater_generator.generation.exit_review import fact_is_guaranteed
from theater_generator.generation.quality import QualityAssessmentError
from test_completion_contract_review import _request, _validate
from test_numeric_v2_generation import _fact_review_payload, _quality_payload, _quality_reply
from test_numeric_v2_names import named_outline
from test_staged_generation import staged_reply


"""Choice reachability is distinct from proving a chosen exit's history."""


def _alternative(value="B", *, kind="completed", outcome="continue", route_ids=None, compatible=True):
    return {"kind": kind, "value": value, "outcome": outcome,
            "route_ids": ["leave"] if route_ids is None else route_ids,
            "entry_compatible": compatible, "reason": "原稿明确允许的合法结果及其后续。",
            "evidence_refs": []}


def _case(value="A"):
    context, sources, targets, payload = _request()
    key = "choice"
    context["fact_contract"]["facts"][key].update(value_type="string", description="双方可最终选择A或B。")
    definition_ref = payload["contract_checks"][0]["evidence_refs"][0]
    sources[definition_ref]["quote"] = "双方可最终选择A或B。"
    context["mainline"][0]["completion_contract"]["all"][0]["equals"] = value
    for row in payload["contract_checks"]:
        row["alternatives"] = []
    alternative = _alternative()
    alternative["evidence_refs"] = payload["contract_checks"][0]["evidence_refs"][:]
    payload["contract_checks"][0]["alternatives"] = [alternative]
    return context, sources, payload


def test_wrong_clear_cannot_hide_a_legal_final_value_excluded_by_the_literal_gate():
    context, sources, payload = _case()
    route = {"advance_on_completion": True, "completion_contract": context["mainline"][0]["completion_contract"]}
    assert fact_is_guaranteed(route, "choice", "A") is True
    with pytest.raises(ValueError, match="choice"):
        _validate(context, sources, payload)


@pytest.mark.parametrize("mutation", ["missing", "unknown_route", "fixed_wrong_entry", "blocked_clear",
                                      "deferral_as_completion", "nonfinal_continue"])
def test_choice_coverage_protocol_rejects_missing_or_self_contradictory_clear(mutation):
    context, sources, payload = _case("B")
    check = payload["contract_checks"][0]
    alternative = check["alternatives"][0]
    if mutation == "missing":
        del check["alternatives"]
    elif mutation == "unknown_route":
        alternative["route_ids"] = ["invented_route"]
    elif mutation == "fixed_wrong_entry":
        alternative["entry_compatible"] = False
    elif mutation == "blocked_clear":
        alternative["outcome"] = "blocked"
    elif mutation == "nonfinal_continue":
        alternative.update(kind="refusal", value=None)
    else:
        alternative.update(kind="deferral", outcome="stay", route_ids=[], entry_compatible=None)
    with pytest.raises(ValueError):
        _validate(context, sources, payload)


def test_an_allowed_final_value_and_a_nonfinal_refusal_can_both_be_clear():
    context, sources, payload = _case("B")
    refusal = deepcopy(payload["contract_checks"][0]["alternatives"][0])
    refusal.update(kind="refusal", value=None, outcome="stay", route_ids=[], entry_compatible=None)
    payload["contract_checks"][0]["alternatives"].append(refusal)
    before = deepcopy((context, sources, payload))
    result = _validate(context, sources, payload)
    assert result["contract_checks"][0]["alternatives"] == payload["contract_checks"][0]["alternatives"]
    assert (context, sources, payload) == before


def test_explicitly_unreachable_final_alternative_keeps_the_check_uncertain():
    context, sources, payload = _case()
    check = payload["contract_checks"][0]
    check["status"] = "uncertain"
    check["alternatives"][0].update(outcome="blocked", route_ids=[], entry_compatible=None)
    result = _validate(context, sources, payload)
    assert result["contract_checks"][0]["status"] == "uncertain"
    assert result["contract_checks"][0]["alternatives"][0]["value"] == "B"
