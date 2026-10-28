import re


_RISKY_CLAIM_PATTERN = re.compile(
    r"\b(?:guarantee(?:s|d|ing)?|always|never|best|perfect|only|risk[- ]free)\b|100\s*%",
    re.IGNORECASE,
)
_NUMBER_PATTERN = re.compile(r"\b\d[\d,]*(?:\.\d+)?%?")
_AVOIDED_TERM_PATTERNS = (
    re.compile(
        r"\b(?:avoid|never\s+(?:use|say|call)|do\s+not\s+(?:use|say|call)|don't\s+(?:use|say|call))\s+(?:(?:the\s+)?(?:term|word)\s+)?[\"“']([^\"”']+)[\"”']",
        re.IGNORECASE,
    ),
    re.compile(r"\bnever\s+refer\s+to\b[^.!?]*?\bas\s+[\"“']([^\"”']+)[\"”']", re.IGNORECASE),
    re.compile(r"\bnever\s+[\"“']([^\"”']+)[\"”']", re.IGNORECASE),
)


def _normalize_number(value: str) -> str:
    return value.replace(",", "").removesuffix("%")


def analyze_rules(
    content: str,
    brand_guidelines: list[str],
    approved_facts: list[str],
    has_image: bool = False,
) -> dict:
    findings: list[dict] = []

    def add_finding(
        issue: str,
        severity: str,
        evidence: str,
        explanation: str,
        suggested_correction: str,
        category: str,
        brand_rule: str = "",
    ) -> None:
        findings.append(
            {
                "issue": issue,
                "severity": severity,
                "evidence": evidence,
                "brand_rule": brand_rule,
                "explanation": explanation,
                "suggested_correction": suggested_correction,
                "confidence": 1.0,
                "category": category,
            }
        )

    risky_percent_numbers: set[str] = set()
    for match in _RISKY_CLAIM_PATTERN.finditer(content):
        phrase = match.group(0)
        if "%" in phrase:
            risky_percent_numbers.add(_normalize_number(phrase))
        add_finding(
            issue=f'Review absolute or guarantee wording: "{phrase}"',
            severity="medium",
            evidence=phrase,
            explanation=(
                "A deterministic phrase check found wording that may imply an "
                "absolute or guaranteed outcome; it does not determine whether "
                "the claim is true."
            ),
            suggested_correction="Review the claim and soften it or support it with an approved fact.",
            category="Promotional claim check",
        )

    seen_terms: set[str] = set()
    for guideline in brand_guidelines:
        for pattern in _AVOIDED_TERM_PATTERNS:
            for match in pattern.finditer(guideline):
                term = match.group(1).strip().rstrip(".,;:!?")
                key = term.casefold()
                if not term or key in seen_terms:
                    continue
                seen_terms.add(key)
                term_pattern = re.compile(
                    rf"(?<![\w])({re.escape(term)})(?![\w])", re.IGNORECASE
                )
                for term_match in term_pattern.finditer(content):
                    evidence = term_match.group(1)
                    add_finding(
                        issue=f'Avoided term in draft: "{evidence}"',
                        severity="low",
                        evidence=evidence,
                        explanation="This term appears in a supplied guideline as wording to avoid.",
                        suggested_correction="Replace it with your brand's preferred wording.",
                        category="Terminology check",
                        brand_rule=guideline,
                    )

    approved_numbers = {
        _normalize_number(match.group(0))
        for fact in approved_facts
        for match in _NUMBER_PATTERN.finditer(fact)
    }
    for sentence_match in re.finditer(r"[^.!?\r\n]+[.!?]?", content):
        sentence = sentence_match.group(0).strip()
        if not sentence:
            continue
        for number_match in _NUMBER_PATTERN.finditer(sentence):
            number = number_match.group(0)
            normalized = _normalize_number(number)
            if normalized in approved_numbers:
                continue
            if number.endswith("%") and normalized in risky_percent_numbers:
                continue
            add_finding(
                issue=f'Number needs verification: "{number}"',
                severity="medium",
                evidence=sentence,
                explanation=(
                    "This number was not found in the approved facts supplied. "
                    "The rule-based check cannot determine whether it is true."
                ),
                suggested_correction="Verify the number against an approved fact or remove it.",
                category="Approved-fact check",
            )

    return {
        "findings": findings,
        "message": (
            "Rule-based review completed. These deterministic checks can flag "
            "matches but cannot verify factual truth or understand context. "
            "Human review is required."
            if not has_image
            else
            "Rule-based review completed. Automated visual analysis is disabled; "
            "a human reviewer must inspect the image. Human review is required."
        ),
    }
