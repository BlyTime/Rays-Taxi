Upload these three files to the root of the BlyTime/Rays-Taxi GitHub repository:

1. driver.js
2. driver.html
3. sw.js

driver.html is the current GitHub version included for convenience; the functional
change is in driver.js. sw.js has a new cache name so installed PWAs receive the
updated driver script.

Test on the same Android phone that has Beacon v0.4.4 installed:

1. Accept a request.
2. Tap En route, Arrived, then Passenger onboard.
3. Firebase is updated to Picked up first.
4. Android opens BLY RIDE Beacon.
5. Beacon verifies the signed-in driver owns the picked-up request.
6. The landscape booked fare meter starts at 0.00 km.

STOP METER & RETURN stops only the native test meter. Complete the Firebase ride
from driver.html for this first pairing test build.
