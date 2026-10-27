from sqlmodel import SQLModel, Session, create_engine

# SQLite stores everything in one file called inkguard.db
engine = create_engine(
    "sqlite:///inkguard.db",
    connect_args={"check_same_thread": False},
)


def init_db():
    # Creates all tables (if they don't exist yet)
    SQLModel.metadata.create_all(engine)


def get_session():
    # Gives each request its own database session, then closes it
    with Session(engine) as session:
        yield session