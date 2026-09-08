"""
Remove the Bluetooth stack's duplicate ECC implementation from the link.

THE PROBLEM
-----------
Arduino-ESP32 links libbt.a into every classic-ESP32 sketch. Inside it, BLE Mesh carries a
tinycrypt-derived ECC implementation that exports the SAME global symbol names as
kmackay/micro-ecc: uECC_compute_public_key, uECC_vli_modMult_fast, uECC_secp256r1, and
several more. Two definitions of one symbol is a hard link error.

WHY NOT -Wl,--allow-multiple-definition
---------------------------------------
It was tried and it is actively dangerous. It does not error, and it does not reliably
"keep ours" - it binds each call site to whichever definition the linker reached first. Here
it bound krishi::derivePublicKey -> uECC_compute_public_key to the BLUETOOTH copy, which
then called back into micro-ecc's internals for the curve maths. The result runs half in
each library with incompatible internal state and panics the moment the device derives its
own identity:

    Guru Meditation Error: Core 1 panic'ed (LoadProhibited)   EXCVADDR: 0x00000008
    uECC_compute_public_key at .../bt/esp_ble_mesh/.../tinycrypt/src/ecc.c:930
    x_side_secp256k1        at .../micro-ecc/curve-specific.inc:1150

Silent mis-linking of the signing path is the worst possible failure for this project:
signing on-device is the whole thesis.

WHY NOT DROP libbt.a ENTIRELY
-----------------------------
Also tried. The Arduino core calls esp_bt_controller_mem_release() unconditionally from
initArduino(), and libcoexist.a references btdm_rf_bb_reg_init for WiFi/BT radio
coexistence. Removing the library breaks the link even though we never use Bluetooth.

THE FIX
-------
Copy libbt.a into the build directory, delete exactly one member from the copy - ecc.c.obj,
the tinycrypt ECC translation unit - and put that directory first on the library search
path. Every real Bluetooth controller function the core needs is still there; the duplicate
ECC symbols are gone, leaving micro-ecc as the single provider. Anything inside libbt.a that
did reference those names now resolves to micro-ecc, which is the intended implementation.

If Bluetooth is ever genuinely used, this must be revisited together with micro-ecc: the two
cannot coexist under their default symbol names, and the right answer then is to vendor
micro-ecc under a symbol prefix rather than to remove anything.
"""

import os
import shutil
import subprocess

Import("env")  # noqa: F821  (injected by PlatformIO/SCons)

# The single translation unit inside libbt.a that duplicates micro-ecc's symbols.
COLLIDING_MEMBER = "ecc.c.obj"

platform = env.PioPlatform()  # noqa: F821
framework_dir = platform.get_package_dir("framework-arduinoespressif32")
mcu = env.BoardConfig().get("build.mcu", "esp32")  # noqa: F821
source_lib = os.path.join(framework_dir, "tools", "sdk", mcu, "lib", "libbt.a")

if not os.path.isfile(source_lib):
    # ESP32-S2 (node-leaf) has no Bluetooth radio and ships no libbt.a - nothing to do.
    print("strip_bt.py: no libbt.a for %s, nothing to patch" % mcu)
else:
    build_dir = env.subst("$BUILD_DIR")  # noqa: F821
    os.makedirs(build_dir, exist_ok=True)
    patched_lib = os.path.join(build_dir, "libbt.a")

    # Re-copy only when the framework's copy is newer, so incremental builds stay fast
    # (libbt.a is tens of megabytes).
    needs_copy = (
        not os.path.isfile(patched_lib)
        or os.path.getmtime(source_lib) > os.path.getmtime(patched_lib)
    )

    if needs_copy:
        shutil.copy2(source_lib, patched_lib)
        ar_tool = env.subst("$AR")  # noqa: F821
        result = subprocess.run(
            [ar_tool, "d", patched_lib, COLLIDING_MEMBER],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "strip_bt.py: failed to remove %s from libbt.a: %s"
                % (COLLIDING_MEMBER, result.stderr.strip())
            )
        print("strip_bt.py: removed %s from a private copy of libbt.a" % COLLIDING_MEMBER)
    else:
        print("strip_bt.py: patched libbt.a already current")

    # Search our patched copy before the framework's, so -lbt resolves to it.
    env.Prepend(LIBPATH=[build_dir])  # noqa: F821
