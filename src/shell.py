import js
import os
import sys
import shlex
import asyncio
import traceback
import contextlib
import platformdirs
from pyodide.ffi import to_js
from glasgow.cli import main
from _pyrepl import readline, unix_console


@contextlib.contextmanager
def readline_reader(reader):
    old_reader = readline._wrapper.reader
    readline._wrapper.reader = reader
    try:
        yield
    finally:
        readline._wrapper.reader = old_reader


def print_exception(exn):
    print(f"\n{''.join(traceback.format_exception(exn, colorize=True))}", file=sys.stderr, end="")


class InteractiveConsole:
    def __init__(self):
        self.console = unix_console.UnixConsole(sys.stdin.fileno(), sys.stdout.fileno(), encoding=sys.getdefaultencoding())
        self.reader = readline.ReadlineAlikeReader(console=self.console, config=readline.ReadlineConfig())
        self.reader.can_colorize = False
        self.reader.ps1 = "\x1b[1;35m>\x1b[m glasgow "

        state_path = platformdirs.user_state_path("GlasgowEmbedded", appauthor=False, ensure_exists=True)
        self.history_filename = state_path / "shell-history"
        try:
            with readline_reader(self.reader):
                readline.read_history_file(self.history_filename)
        except FileNotFoundError:
            pass

        # HistoricalReader saves duplicate lines, so add lines to history on our own;
        # this setting can only be configured globally
        readline.set_auto_history(False)

    def read_line(self):
        while True:
            try:
                line = self.reader.readline().strip()
                if line != "":
                    break
            except (KeyboardInterrupt, asyncio.CancelledError):
                print()
                raise
        with readline_reader(self.reader):
            if line != readline.get_history_item(readline.get_history_length()):
                readline.add_history(line)
                readline.append_history_file(self.history_filename)
        return line

    async def interact(self):
        try:
            await js.syncFSFromBacking()
        except BaseException as exn:
            print_exception(exn)
        try:
            command = self.read_line()
            sys.argv = ["glasgow", *shlex.split(command)]
            os.environ["GLASGOW_COLORS"] = "TRACE=37:INFO=1;37"

            interrupt_fut = asyncio.get_event_loop().create_future()
            js.setInterruptFuture(to_js(interrupt_fut))
            js.setIsExecutingCommand(True)
            try:
                async def run_main():
                    await main()
                    interrupt_fut.cancel()
                async def wait_for_interrupt():
                    return await interrupt_fut
                async with asyncio.TaskGroup() as group:
                    group.create_task(run_main())
                    group.create_task(wait_for_interrupt())
            except (KeyboardInterrupt, asyncio.CancelledError):
                pass
            except BaseException as exn:
                print_exception(exn)
            finally:
                js.setIsExecutingCommand(False)
        finally:
            try:
                await js.syncFSToBacking()
            except BaseException as exn:
                print_exception(exn)
            print()


console = InteractiveConsole()
try:
    while True:
        try:
            await console.interact()
        except (EOFError, KeyboardInterrupt, asyncio.CancelledError):
            pass
except BaseException as exn:
    print_exception(exn)
