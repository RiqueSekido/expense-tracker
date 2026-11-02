"""Persist the display preference for personal Devendo entries."""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("expenses", sa.Column("devendo_hidden", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table("expenses") as batch:
        batch.drop_column("devendo_hidden")
