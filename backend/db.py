import os
from pathlib import Path

from sqlalchemy.engine import URL
from sqlmodel import SQLModel, Session, create_engine

database_path = Path(os.getenv("INKGUARD_DATABASE_PATH", "inkguard.db")).expanduser()
if str(database_path) != ":memory:":
    database_path.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    URL.create("sqlite", database=str(database_path)),
    connect_args={"check_same_thread": False},
)


def init_db():
    # Creates all tables (if they don't exist yet)
    SQLModel.metadata.create_all(engine)
    migrate_review_columns(engine)


def migrate_review_columns(database_engine):
    migrations = {
        "draft": {
            "owner_id": "INTEGER REFERENCES user(id)",
            "brand_name": "VARCHAR NOT NULL DEFAULT ''",
            "brand_guidelines_json": "TEXT NOT NULL DEFAULT '[]'",
            "approved_facts_json": "TEXT NOT NULL DEFAULT '[]'",
        },
        "finding": {
            "issue": "VARCHAR NOT NULL DEFAULT ''",
            "severity": "VARCHAR NOT NULL DEFAULT 'medium'",
            "confidence": "FLOAT",
            "category": "VARCHAR",
        },
        "decision": {
            "reason": "VARCHAR",
        },
    }
    with database_engine.begin() as connection:
        for table, columns in migrations.items():
            existing_columns = {
                row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table})")
            }
            for name, definition in columns.items():
                if name not in existing_columns:
                    connection.exec_driver_sql(
                        f"ALTER TABLE {table} ADD COLUMN {name} {definition}"
                    )


def get_session():
    # Gives each request its own database session, then closes it
    with Session(engine) as session:
        yield session