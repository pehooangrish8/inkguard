def analyze(text: str):
    # Temporary hard-coded findings. Member 3's real AI will replace this later.
    return [
        {
            "quote": "10 million users",
            "evidence_level": "confirmed",
            "explanation": "The approved fact says ExampleCorp has 8 million users.",
            "source_id": "FACT-03",
            "source_text": "ExampleCorp has 8 million users (2026).",
            "suggestion": "We have over 8 million users",
        },
        {
            "quote": "guarantee 100% results",
            "evidence_level": "confirmed",
            "explanation": "Guaranteed-result claims are not allowed without proof.",
            "source_id": "RULE-07",
            "source_text": "Do not make guaranteed-result claims.",
            "suggestion": "Helps many customers reach their goals",
        },
        {
            "quote": "Act now!!!",
            "evidence_level": "possible",
            "explanation": "The tone may be too pushy for the brand voice.",
            "source_id": None,
            "source_text": None,
            "suggestion": "Get started today",
        },
    ]