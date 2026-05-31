from redis import Redis
from rq import Queue, Worker

from shared.config import REDIS_URL, RQ_QUEUE


def main() -> None:
    redis_conn = Redis.from_url(REDIS_URL)
    queue = Queue(RQ_QUEUE, connection=redis_conn)
    worker = Worker([queue], connection=redis_conn)
    worker.work()


if __name__ == "__main__":
    main()
