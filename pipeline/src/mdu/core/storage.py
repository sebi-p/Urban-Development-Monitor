"""Object storage on Cloudflare R2 through its S3 API (PLAN §4)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import TYPE_CHECKING

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

if TYPE_CHECKING:  # type stubs are a dev dependency; the daily run installs without them
    from mypy_boto3_s3 import S3Client

ENV_VARS = ("R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")


class StorageNotConfigured(RuntimeError):
    pass


@dataclass
class ObjectStore:
    bucket: str
    client: S3Client

    @classmethod
    def from_env(cls) -> ObjectStore:
        missing = [v for v in ENV_VARS if not os.environ.get(v)]
        if missing:
            raise StorageNotConfigured(f"set {', '.join(missing)} (see .env.example)")
        client = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
            config=Config(retries={"max_attempts": 5, "mode": "standard"}),
        )
        return cls(bucket=os.environ["R2_BUCKET"], client=client)

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise
        return True

    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        extra = {"ContentType": content_type} if content_type else {}
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, **extra)  # type: ignore[arg-type]

    def age_days(self, key: str) -> float | None:
        """Days since the object was last written; None when it doesn't exist."""
        from datetime import UTC, datetime  # noqa: PLC0415

        try:
            head = self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise
        return (datetime.now(UTC) - head["LastModified"]).total_seconds() / 86400

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
