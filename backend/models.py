"""
models.py – SQLAlchemy ORM models.
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime
from database import Base
from sqlalchemy.sql import func


def generate_uuid():
    return str(uuid.uuid4())


class Meeting(Base):
    __tablename__ = "meetings"

    id         = Column(String,   primary_key=True, default=generate_uuid, index=True)
    title      = Column(String,   default="Untitled Meeting", nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),   # Python-side fallback
        server_default=func.now(),                     # PostgreSQL-side
        nullable=False
    )
    transcript = Column(Text,     default="", nullable=False)
    summary    = Column(Text,     default=None, nullable=True)
