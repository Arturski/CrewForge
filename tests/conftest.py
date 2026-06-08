import os
import tempfile

# Point the store at a throwaway DB before server.store is imported anywhere.
os.environ.setdefault("CREWFORGE_DB", os.path.join(tempfile.mkdtemp(), "test.db"))
