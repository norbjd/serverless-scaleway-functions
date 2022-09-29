import json
import os


def handle(event, context):
    """handle a request to the function
    Args:
        event (dict): request params
        context (dict): function call metadata
    """

    # print all environment variables as key=value beginning with "env"
    return {
        "env_vars": sorted(
            [key + "=" + value for key, value in os.environ.items() if key.startswith("env")]
        )
    }
