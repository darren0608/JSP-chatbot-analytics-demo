"""Email/password auth (prototype-grade per brief §7). Consent to analytics is
captured at sign-up (PDPA gate, §11). Email-verification seam: users could get
a `verified_at` column + token flow without schema upheaval.

Account deletion (§11): hard-deletes the user; conversations, messages, and
analytics rows cascade.
"""
import re

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..models import User
from ..security import create_session_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class SignupRequest(BaseModel):
    email: str
    password: str
    consent_analytics: bool = False

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("invalid email address")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    role: str
    consent_analytics: bool


def _set_session(response: Response, user: User) -> None:
    token = create_session_token(user.id, user.role)
    response.set_cookie(
        settings.cookie_name, token,
        httponly=True, samesite="lax", secure=settings.cookie_secure,
        max_age=settings.jwt_ttl_hours * 3600, path="/",
    )


def _user_out(user: User) -> UserOut:
    return UserOut(id=user.id, email=user.email, role=user.role,
                   consent_analytics=user.consent_analytics)


@router.post("/signup", response_model=UserOut)
def signup(body: SignupRequest, response: Response, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=body.email, password_hash=hash_password(body.password),
                role="user", consent_analytics=body.consent_analytics)
    db.add(user)
    db.commit()
    _set_session(response, user)
    return _user_out(user)


@router.post("/login", response_model=UserOut)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.strip().lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    _set_session(response, user)
    return _user_out(user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(settings.cookie_name, path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return _user_out(user)


class ConsentRequest(BaseModel):
    consent_analytics: bool


@router.patch("/consent", response_model=UserOut)
def update_consent(body: ConsentRequest, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    user.consent_analytics = body.consent_analytics
    db.add(user)
    db.commit()
    return _user_out(user)


@router.delete("/account")
def delete_account(response: Response, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    db.delete(user)  # conversations/messages/analytics cascade
    db.commit()
    response.delete_cookie(settings.cookie_name, path="/")
    return {"ok": True}
