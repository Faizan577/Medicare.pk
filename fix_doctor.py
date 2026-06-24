path = r'c:\Users\FAIZAN\Downloads\Health\Health\public\doctor.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Count occurrences of btn-present
count = content.count('btn-present')
print(f'Found btn-present {count} times')

# Find and remove from queue section (second occurrence after the first one in token table)
# The token table one was already handled, now handle queue table
# Replace all remaining btn-present/btn-late pairs in the renderQueueTable function

import re

# Pattern to find in renderQueueTable
old_snippet = (
    '                            ${isCalled ? `\n'
    '                                <button class="btn-present" onclick="markPresent(${t.token_id})"><i class="fas fa-check"></i> Present</button>\n'
    '                                <button class="btn-late" onclick="markLate(${t.token_id})"><i class="fas fa-times"></i> Late</button>\n'
    '                            ` : \'\'}\n'
    '                        </div>\n'
    '                    </td>\n'
    '                </tr>\n'
    '            `}).join(\'\');\n'
    '\n'
    '            // Start countdowns in queue tab too'
)

new_snippet = (
    '                            ${isCalled ? `<span style="font-size:0.75rem;color:#92400e;background:#fef3c7;padding:4px 9px;border-radius:8px;font-weight:600;"><i class="fas fa-bell me-1"></i>Awaiting Admin</span>` : \'\'}\n'
    '                        </div>\n'
    '                    </td>\n'
    '                </tr>\n'
    '            `}).join(\'\');\n'
    '\n'
    '            // Start countdowns in queue tab too'
)

if old_snippet in content:
    content = content.replace(old_snippet, new_snippet, 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('SUCCESS: Present/Late buttons removed from queue tab in doctor.html')
else:
    print('Pattern not found exactly. Trying with \\r\\n...')
    old_crlf = old_snippet.replace('\n', '\r\n')
    new_crlf = new_snippet.replace('\n', '\r\n')
    if old_crlf in content:
        content = content.replace(old_crlf, new_crlf, 1)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print('SUCCESS with CRLF')
    else:
        # Show remaining btn-present context
        idx = content.find('btn-present')
        while idx != -1:
            print(f'--- btn-present at {idx} ---')
            print(repr(content[max(0,idx-200):idx+300]))
            idx = content.find('btn-present', idx+1)
