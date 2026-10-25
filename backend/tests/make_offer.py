# Helper: create a fresh offer for Hank and print its ticket id (usage: python make_offer.py "<text>")
import sys
sys.path.insert(0, "/app/backend/tests")
from test_single_slot_and_missed import _new_offer
print(_new_offer(sys.argv[1]))
