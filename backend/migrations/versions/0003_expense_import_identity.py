"""Store source details to keep imported expenses identifiable."""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("expenses", sa.Column("source_description", sa.String(200), nullable=True))
    op.add_column("expenses", sa.Column("source_document", sa.String(100), nullable=True))
    op.add_column("expenses", sa.Column("import_key", sa.String(64), nullable=True))
    op.create_index("ix_expenses_import_key", "expenses", ["import_key"], unique=True)


def downgrade():
    op.drop_index("ix_expenses_import_key", table_name="expenses")
    op.drop_column("expenses", "import_key")
    op.drop_column("expenses", "source_document")
    op.drop_column("expenses", "source_description")
