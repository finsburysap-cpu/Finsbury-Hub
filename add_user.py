"""
Finsbury Hub — Add User Script
================================
Run this once to add users to the Supabase users table.
Passwords are hashed with SHA-256 before storing.

Usage:
    python add_user.py

Requirements:
    pip install supabase python-dotenv
"""

import hashlib
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def add_user(email: str, full_name: str, password: str,
             can_stock: bool = True, can_ar: bool = False):
    result = sb.table("users").upsert({
        "email":            email.lower().strip(),
        "full_name":        full_name,
        "password_hash":    hash_password(password),
        "can_access_stock": can_stock,
        "can_access_ar":    can_ar,
        "is_active":        True,
    }, on_conflict="email").execute()
    print(f"Added/updated user: {email}")
    return result

# ── Add your users here ────────────────────────────
# add_user("email@finsbury.co.ke", "Full Name", "their-password", can_stock=True, can_ar=False)

add_user(
    email="azham@finsbury.co.ke",
    full_name="Azham",
    password="!Finsbury123",
    can_stock=True,
    can_ar=True,
)

# Add more users as needed:
# add_user("staff@finsbury.co.ke", "Staff Name", "their-password", can_stock=True)

print("\nDone. Users added to Supabase.")
print("They can now log in at the Finsbury Hub URL.")
