"""Separate personal reimbursements from salary transfers."""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("expenses") as batch:
        batch.add_column(sa.Column("devendo_type", sa.String(8), nullable=False, server_default="personal"))
        batch.create_check_constraint("valid_devendo_type", "devendo_type IN ('personal', 'salary')")


def downgrade():
    with op.batch_alter_table("expenses") as batch:
        batch.drop_constraint("valid_devendo_type", type_="check")
        batch.drop_column("devendo_type")
