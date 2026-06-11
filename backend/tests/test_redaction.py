from app.analytics.redaction import redact


def test_email_redacted():
    assert "[email]" in redact("contact me at jane.doe+x@gmail.com please")
    assert "jane.doe" not in redact("contact me at jane.doe+x@gmail.com please")


def test_nric_redacted():
    out = redact("my nric is S1234567D thanks")
    assert "S1234567D" not in out and "[nric]" in out


def test_phone_redacted():
    out = redact("call me at 9123 4567 or +65 81234567")
    assert "9123" not in out


def test_name_intro_redacted():
    out = redact("Hi, my name is Tan Ah Kow and I want to be a data analyst")
    assert "Ah Kow" not in out
    assert "data analyst" in out  # domain content preserved


def test_plain_text_untouched():
    text = "what skills do i need to become a data analyst"
    assert redact(text) == text
