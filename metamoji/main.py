from templates import TEMPLATES
import argparse
import sys

HEIGHT = 5
SPACING = 3

def handle_char(lines, letter, emotes):
    rows = TEMPLATES[letter]
    n = len(emotes)

    for i, r in enumerate(rows):
        replaced = r.replace('#', f':{emotes[i%n]}:')\
            .replace(' ', f':void:')
        lines[i].append(replaced)

    for line in lines:
        line.append(' ' * SPACING)


def print_emoji(lines):
    for line in lines:
        print("".join(line))


def build_parser():
    parser = argparse.ArgumentParser(
                prog='Metamoji',
                description='Generates emoji templates',
                epilog='Remember to have fun :)')
    parser.add_argument('word')
    parser.add_argument('-e', '--emotes', nargs='*', default='eyes')
    return parser

if __name__ == '__main__':
    args = build_parser().parse_args()

    lines = [[] for _ in range(HEIGHT)]

    for c in args.word:
        handle_char(lines, c, args.emotes)

    print_emoji(lines)





