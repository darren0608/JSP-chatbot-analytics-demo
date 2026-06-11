from conftest import signup


def test_signup_login_me_logout(client):
    user = signup(client)
    assert user["email"] == "user@example.com"
    assert user["role"] == "user"

    r = client.get("/api/auth/me")
    assert r.status_code == 200

    r = client.post("/api/auth/logout")
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 401

    r = client.post("/api/auth/login", json={"email": "user@example.com",
                                             "password": "password123"})
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_duplicate_email_rejected(client):
    signup(client)
    r = client.post("/api/auth/signup", json={"email": "user@example.com",
                                              "password": "password123"})
    assert r.status_code == 409


def test_bad_password_rejected(client):
    signup(client)
    r = client.post("/api/auth/login", json={"email": "user@example.com",
                                             "password": "wrong-password"})
    assert r.status_code == 401


def test_weak_password_rejected(client):
    r = client.post("/api/auth/signup", json={"email": "a@b.co", "password": "short"})
    assert r.status_code == 422


def test_admin_routes_forbidden_for_user(client):
    signup(client)
    assert client.get("/api/admin/overview").status_code == 403
