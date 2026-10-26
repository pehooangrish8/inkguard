
from fastapi import FastAPI

app = FastAPI(title="InkGuard API")


@app.get("/")
def home():
    return {"message": "Welcome to InkGuard API"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}
