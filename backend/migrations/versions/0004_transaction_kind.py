"""Distinguish imported income from expenses."""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("expenses") as batch:
        batch.add_column(sa.Column("kind", sa.String(7), nullable=False, server_default="expense"))
        batch.create_check_constraint("valid_expense_kind", "kind IN ('income', 'expense')")


def downgrade():
    with op.batch_alter_table("expenses") as batch:
        batch.drop_constraint("valid_expense_kind", type_="check")
        batch.drop_column("kind")
