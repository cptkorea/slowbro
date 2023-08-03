from templates import TEMPLATES
import sys

HEIGHT = 5
SPACING = 3

def handle_char(lines, letter, emote):
    rows = TEMPLATES[letter]

    for i, r in enumerate(rows):
        replaced = r.replace('#', f':{emote}:')\
            .replace(' ', f':transparent:')
        lines[i].append(replaced)

    for line in lines:
        line.append(' ' * SPACING)


def print_emoji(lines):
    for line in lines:
        print("".join(line))


if __name__ == '__main__':
    word = sys.argv[1]
    emote = sys.argv[2]

    lines = [[] for _ in range(HEIGHT)]

    for c in word:
        handle_char(lines, c, emote)

    print_emoji(lines)





